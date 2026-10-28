import {
  LETTER_SECTION,
  MAX_ITEM_NUMBER,
  SECTION_NAMES,
  formatNextIds,
  highestIds,
  parseDocument,
  readsAsStructure,
  type Letter,
  type NextIds,
  type ParsedDocument,
  type Section
} from './document.ts'

export type EditResult =
  | { ok: true; text: string; id: string | null; noteLine: string | null }
  | { ok: false; id: string; message: string }

type SectionName = (typeof SECTION_NAMES)[number]

type NewDocumentInput = {
  slug: string
  title: string
  goal: string
  nextStep: string
  criteria: readonly string[]
  details: readonly string[]
  now: string
}

const STATUS_PREFIX = 'Status:'
const UPDATED_PREFIX = 'Updated:'
const NEXT_IDS_PREFIX = 'Next ids:'
const NEW_STATUS = 'active'
const NOT_STARTED = 'Not started.'
export const NEXT_STEP_SECTION: SectionName = 'Next step'
const UNREADABLE = 'unreadable'
const NO_NEXT_STEP = 'none'
const EVIDENCE_MARKER = ' evidence: '
const STRUCK_MARKER = ' struck: '
const REOPENED_MARKER = ' reopened: '
const WHITESPACE_RUN_PATTERN = /\s+/g
const SENTENCE_PATTERN = /^.*?[.!?](?=\s|$)/
const FINAL_MARK_PATTERN = /[.!?]$/

export const oneLine = (text: string): string => text.replace(WHITESPACE_RUN_PATTERN, ' ').trim()

const escapedLine = (line: string): string => (readsAsStructure(line) ? `\\${line}` : line)

const splitText = (text: string): string[] => {
  const lines = text.split('\n')
  return text.endsWith('\n') ? lines.slice(0, -1) : lines
}

const joinLike = (lines: readonly string[], original: string): string =>
  `${lines.join('\n')}${original.endsWith('\n') ? '\n' : ''}`

const isBlank = (line: string): boolean => line.trim() === ''

const withoutBlankEnds = (lines: readonly string[]): string[] => {
  const first = lines.findIndex((line) => !isBlank(line))
  const last = lines.reduce((found, line, index) => (isBlank(line) ? found : index), -1)
  return first < 0 ? [] : lines.slice(first, last + 1)
}

const replaceAt = (lines: readonly string[], index: number, line: string): string[] => [
  ...lines.slice(0, index),
  line,
  ...lines.slice(index + 1)
]

const insertAt = (lines: readonly string[], index: number, line: string): string[] => [
  ...lines.slice(0, index),
  line,
  ...lines.slice(index)
]

const removeAt = (lines: readonly string[], index: number): string[] => [
  ...lines.slice(0, index),
  ...lines.slice(index + 1)
]

const sectionNamed = (parsed: ParsedDocument, name: string): Section | undefined =>
  parsed.sections.find((section) => section.name === name)

const headingFollows = (lines: readonly string[], section: Section): boolean =>
  section.line + section.body.length < lines.length

const framedBody = (content: readonly string[], followed: boolean): string[] => {
  const closing = followed ? [''] : []
  return content.length === 0 ? closing : ['', ...content, ...closing]
}

const withBody = (lines: readonly string[], section: Section, body: readonly string[]): string[] => [
  ...lines.slice(0, section.line),
  ...body,
  ...lines.slice(section.line + section.body.length)
]

const appendToSection = (lines: readonly string[], section: Section, line: string): string[] => {
  const lastFilled = section.body.reduce((found, body, index) => (isBlank(body) ? found : index), -1)
  return lastFilled < 0
    ? withBody(lines, section, framedBody([line], headingFollows(lines, section)))
    : insertAt(lines, section.line + lastFilled + 1, line)
}

const nextIdsIndex = (lines: readonly string[], parsed: ParsedDocument): number => {
  const end = (parsed.sections[0]?.line ?? parsed.noteLine ?? lines.length + 1) - 1
  return lines.findIndex((line, index) => index < end && line.startsWith(NEXT_IDS_PREFIX))
}

const freeIds = (text: string, parsed: ParsedDocument): NextIds => {
  const highest = highestIds(text)
  const stated = parsed.nextIds ?? highest
  return {
    c: Math.max(stated.c, highest.c),
    D: Math.max(stated.D, highest.D),
    R: Math.max(stated.R, highest.R),
    S: Math.max(stated.S, highest.S)
  }
}

const accepted = (text: string, id: string | null, noteLine: string | null): EditResult => ({
  ok: true,
  text,
  id,
  noteLine
})

const unknownId = (id: string): EditResult => ({ ok: false, id, message: `the document has no item ${id}` })

const sectionBodyLines = (name: string, body: readonly string[]): string[] => [
  `## ${name}`,
  '',
  ...body,
  ...(body.length === 0 ? [] : [''])
]

const bodyOf = (text: string): string[] => (text === '' ? [] : [escapedLine(text)])

export const newDocument = (input: NewDocumentInput): string => {
  const criteria = input.criteria.map(oneLine)
  const bodies: Record<SectionName, string[]> = {
    Goal: bodyOf(oneLine(input.goal)),
    'Done when': criteria.map((text, index) => `- [ ] c${index + 1} ${text}`),
    'Where things stand': [NOT_STARTED],
    'Next step': bodyOf(oneLine(input.nextStep)),
    'Decisions in force': [],
    'Open risks': [],
    'Settled, do not reopen': [],
    'Where the details live': input.details.map((line) => `- ${oneLine(line)}`)
  }
  const lines = [
    `# ${oneLine(input.slug)}: ${oneLine(input.title)}`,
    `${STATUS_PREFIX} ${NEW_STATUS}`,
    `${UPDATED_PREFIX} ${oneLine(input.now)}`,
    formatNextIds({ c: criteria.length + 1, D: 1, R: 1, S: 1 }),
    '',
    ...SECTION_NAMES.flatMap((name) => sectionBodyLines(name, bodies[name]))
  ]
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

export const setStatus = (text: string, status: string): EditResult => {
  const parsed = parseDocument(text)
  if (parsed.statusLine === null) {
    return { ok: false, id: 'Status', message: 'the document has no Status line after its title line' }
  }
  const lines = replaceAt(splitText(text), parsed.statusLine - 1, `${STATUS_PREFIX} ${oneLine(status)}`)
  return accepted(joinLike(lines, text), null, null)
}

export const replaceSection = (text: string, section: string, bodyLines: readonly string[]): EditResult => {
  const parsed = parseDocument(text)
  const target = sectionNamed(parsed, section)
  if (target === undefined) {
    return { ok: false, id: section, message: `the document has no section "## ${section}"` }
  }
  const lines = splitText(text)
  const body = framedBody(withoutBlankEnds(bodyLines.map(oneLine)).map(escapedLine), headingFollows(lines, target))
  return accepted(joinLike(withBody(lines, target, body), text), null, null)
}

export const addItem = (text: string, letter: Letter, itemText: string): EditResult => {
  const parsed = parseDocument(text)
  const ids = freeIds(text, parsed)
  const id = `${letter}${ids[letter]}`
  if (ids[letter] > MAX_ITEM_NUMBER) {
    return { ok: false, id, message: `the ${letter} ids of this thread are used up` }
  }
  const home = LETTER_SECTION[letter]
  const target = sectionNamed(parsed, home)
  if (target === undefined) {
    return { ok: false, id, message: `the document has no section "## ${home}" to hold ${id}` }
  }
  const lines = splitText(text)
  const idsIndex = nextIdsIndex(lines, parsed)
  const raised = formatNextIds({ ...ids, [letter]: ids[letter] + 1 })
  const withIds = idsIndex < 0 ? lines : replaceAt(lines, idsIndex, raised)
  const itemLine = letter === 'c' ? `- [ ] ${id} ${oneLine(itemText)}` : `- ${id} ${oneLine(itemText)}`
  return accepted(joinLike(appendToSection(withIds, target, itemLine), text), id, null)
}

const criterionEdit = (text: string, id: string, box: 'x' | '~' | ' ', marker: string, reason: string): EditResult => {
  const item = parseDocument(text).items.find((candidate) => candidate.id === id)
  if (item === undefined) return unknownId(id)
  if (item.letter !== 'c') {
    return {
      ok: false,
      id,
      message: `${id} is not a criterion; only the c items under "## ${LETTER_SECTION.c}" are ticked, struck or reopened`
    }
  }
  const line = `- [${box}] ${item.id} ${item.text.trimEnd()}${marker}${oneLine(reason)}`
  return accepted(joinLike(replaceAt(splitText(text), item.line - 1, line), text), item.id, null)
}

export const tickCriterion = (text: string, id: string, evidence: string): EditResult =>
  criterionEdit(text, id, 'x', EVIDENCE_MARKER, evidence)

export const strikeCriterion = (text: string, id: string, reason: string): EditResult =>
  criterionEdit(text, id, '~', STRUCK_MARKER, reason)

export const reopenCriterion = (text: string, id: string, reason: string): EditResult =>
  criterionEdit(text, id, ' ', REOPENED_MARKER, reason)

export const removeItem = (text: string, id: string, reason: string): EditResult => {
  const item = parseDocument(text).items.find((candidate) => candidate.id === id)
  if (item === undefined) return unknownId(id)
  const lines = removeAt(splitText(text), item.line - 1)
  return accepted(joinLike(lines, text), item.id, `Removed: ${item.id} because ${oneLine(reason)}`)
}

export const firstSentence = (nextStepBody: string): string => {
  const line = (nextStepBody.trimStart().split('\n')[0] ?? '').trim()
  if (line === '') return NO_NEXT_STEP
  return SENTENCE_PATTERN.exec(line)?.[0] ?? line
}

const readable = (value: string | null | undefined): string =>
  value === null || value === undefined || value.trim() === '' ? UNREADABLE : value

const nextStepOf = (parsed: ParsedDocument): string =>
  firstSentence(sectionNamed(parsed, NEXT_STEP_SECTION)?.body.join('\n') ?? '')

export const userLine = (text: string, path: string): string => {
  const parsed = parseDocument(text)
  const sentence = nextStepOf(parsed)
  const period = FINAL_MARK_PATTERN.test(sentence) ? '' : '.'
  return `Logbook: ${readable(parsed.title)} - ${readable(parsed.status?.raw)}. Next: ${sentence}${period} Full state: ${path}`
}

export const READ_WORKING_COPY_STEP = 'read the working copy.'

export const READ_WORKING_COPY = `Next: ${READ_WORKING_COPY_STEP}`

export const nextStepDiffers = (parts: readonly string[]): boolean => parts.includes(NEXT_STEP_SECTION)

export const differenceSentence = (path: string, parts: readonly string[]): string =>
  `The working copy ${path} differs from the committed document in ${parts.join(', ')}.`

export const differenceUserLine = (text: string, path: string, parts: readonly string[]): string => {
  if (parts.length === 0) return userLine(text, path)
  const sentence = differenceSentence(path, parts)
  if (!nextStepDiffers(parts)) return `${userLine(text, path)} ${sentence}`
  const parsed = parseDocument(text)
  return `Logbook: ${readable(parsed.title)} - ${readable(parsed.status?.raw)}. ${READ_WORKING_COPY} ${sentence}`
}

export const rosterLine = (text: string): string => {
  const parsed = parseDocument(text)
  return `${readable(parsed.slug)} - ${readable(parsed.status?.raw)} - Next: ${nextStepOf(parsed)}`
}
