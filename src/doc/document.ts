export type Letter = 'c' | 'D' | 'R' | 'S'

export type NextIds = { c: number; D: number; R: number; S: number }

export type StatusKind = 'active' | 'blocked' | 'waiting' | 'parked' | 'done' | 'abandoned'

export type Status = { raw: string; kind: StatusKind | null; reason: string | null }

export type Item = {
  id: string
  letter: Letter
  number: number
  box: ' ' | 'x' | '~' | null
  text: string
  section: string
  line: number
}

export type Section = { name: string; line: number; body: string[] }

export type ParsedDocument = {
  slug: string | null
  title: string | null
  status: Status | null
  statusLine: number | null
  updated: string | null
  nextIds: NextIds | null
  sections: Section[]
  items: Item[]
  badLines: { line: number; text: string; section: string }[]
  conflictLines: { line: number; text: string }[]
  note: string | null
  noteLine: number | null
}

export const SECTION_NAMES = [
  'Goal',
  'Done when',
  'Where things stand',
  'Next step',
  'Decisions in force',
  'Open risks',
  'Settled, do not reopen',
  'Where the details live'
] as const

export const NOTE_HEADING = 'This update'

export const LETTER_SECTION = {
  c: 'Done when',
  D: 'Decisions in force',
  R: 'Open risks',
  S: 'Settled, do not reopen'
} as const satisfies Record<Letter, (typeof SECTION_NAMES)[number]>

const LETTERS: readonly Letter[] = ['c', 'D', 'R', 'S']
const BOXES: readonly (' ' | 'x' | '~')[] = [' ', 'x', '~']
const STATUS_KINDS: readonly StatusKind[] = ['active', 'blocked', 'waiting', 'parked', 'done', 'abandoned']
const PLAIN_KINDS: readonly StatusKind[] = ['active', 'parked', 'done']
const ITEM_SECTIONS: readonly string[] = Object.values(LETTER_SECTION)

const HEADING_PREFIX = '## '
const STATUS_PREFIX = 'Status:'
const UPDATED_PREFIX = 'Updated:'
const NEXT_IDS_PREFIX = 'Next ids:'
const LIST_PREFIX = '- '
const TITLE_PATTERN = /^# ([^\s:]+): (.*)$/
const REASONED_STATUS_PATTERN = /^(blocked|waiting|abandoned)(?::(.*))?$/
const ITEM_PATTERN = /^- (?:\[( |x|~)\] )?([cDRS])([1-9][0-9]*) (.*)$/
const NEXT_ID_TOKEN_PATTERN = /^([cDRS])(0|[1-9][0-9]*)$/
const CONFLICT_MARKERS: readonly string[] = ['<<<<<<<', '|||||||', '>>>>>>>']
const CONFLICT_SEPARATOR = '======='

const splitLines = (text: string): string[] => {
  const lines = text.split('\n')
  return text.endsWith('\n') ? lines.slice(0, -1) : lines
}

const isBlank = (line: string): boolean => line.trim() === ''

const dropTrailingBlank = (lines: readonly string[]): string[] =>
  lines.slice(0, lines.reduce((end, line, index) => (isBlank(line) ? end : index + 1), 0))

const dropLeadingBlank = (lines: readonly string[]): string[] => {
  const firstFilled = lines.findIndex((line) => !isBlank(line))
  return firstFilled < 0 ? [] : lines.slice(firstFilled)
}

const isHeading = (line: string): boolean => line.startsWith(HEADING_PREFIX)

const headingName = (line: string): string => line.slice(HEADING_PREFIX.length).trim()

const firstHeadingIndex = (lines: readonly string[]): number => {
  const index = lines.findIndex(isHeading)
  return index < 0 ? lines.length : index
}

const headerIndex = (lines: readonly string[], prefix: string): number => {
  const end = firstHeadingIndex(lines)
  return lines.findIndex((line, index) => index < end && line.startsWith(prefix))
}

const isConflictLine = (line: string): boolean =>
  line === CONFLICT_SEPARATOR ||
  CONFLICT_MARKERS.some((marker) => line === marker || line.startsWith(`${marker} `))

const statusKindOf = (word: string | undefined): StatusKind | undefined =>
  STATUS_KINDS.find((kind) => kind === word)

const letterOf = (value: string | undefined): Letter | undefined => LETTERS.find((letter) => letter === value)

const boxOf = (value: string | undefined): ' ' | 'x' | '~' | null => BOXES.find((box) => box === value) ?? null

const parseStatus = (value: string): Status => {
  const raw = value.trim()
  const plain = PLAIN_KINDS.find((kind) => kind === raw)
  if (plain !== undefined) return { raw, kind: plain, reason: null }
  const match = REASONED_STATUS_PATTERN.exec(raw)
  const kind = statusKindOf(match?.[1])
  if (match === null || kind === undefined) return { raw, kind: null, reason: null }
  const reason = (match[2] ?? '').trim()
  return { raw, kind, reason: reason === '' ? null : reason }
}

const parseNextIds = (value: string): NextIds | null => {
  const tokens = value.trim().split(/\s+/)
  if (tokens.length !== LETTERS.length) return null
  const numberOf = (letter: Letter): number | null => {
    const numbers = tokens.flatMap((token) => {
      const match = NEXT_ID_TOKEN_PATTERN.exec(token)
      return match !== null && match[1] === letter ? [Number(match[2])] : []
    })
    const only = numbers[0]
    return numbers.length === 1 && only !== undefined && Number.isSafeInteger(only) ? only : null
  }
  const c = numberOf('c')
  const D = numberOf('D')
  const R = numberOf('R')
  const S = numberOf('S')
  return c === null || D === null || R === null || S === null ? null : { c, D, R, S }
}

const headerValue = (lines: readonly string[], prefix: string): { value: string; line: number } | null => {
  const index = headerIndex(lines, prefix)
  const line = lines[index]
  return index < 0 || line === undefined ? null : { value: line.slice(prefix.length), line: index + 1 }
}

type ParsedLine = { kind: 'item'; item: Item } | { kind: 'bad'; line: number; text: string; section: string } | null

const parseSectionLine = (section: Section, text: string, line: number): ParsedLine => {
  if (!ITEM_SECTIONS.includes(section.name) || !text.startsWith(LIST_PREFIX)) return null
  const match = ITEM_PATTERN.exec(text)
  const letter = letterOf(match?.[2])
  if (match === null || letter === undefined) return { kind: 'bad', line, text, section: section.name }
  const number = Number(match[3])
  return {
    kind: 'item',
    item: {
      id: `${letter}${match[3]}`,
      letter,
      number,
      box: boxOf(match[1]),
      text: match[4] ?? '',
      section: section.name,
      line
    }
  }
}

export const parseDocument = (text: string): ParsedDocument => {
  const lines = splitLines(text)
  const headingIndexes = lines.flatMap((line, index) => (isHeading(line) ? [index] : []))
  const allSections: Section[] = headingIndexes.map((start, position) => ({
    name: headingName(lines[start] ?? ''),
    line: start + 1,
    body: lines.slice(start + 1, headingIndexes[position + 1] ?? lines.length)
  }))
  const lastSection = allSections.at(-1)
  const noteSection = lastSection !== undefined && lastSection.name === NOTE_HEADING ? lastSection : null
  const sections = noteSection === null ? allSections : allSections.slice(0, -1)
  const parsedLines = sections.flatMap((section) =>
    section.body.map((body, offset) => parseSectionLine(section, body, section.line + 1 + offset))
  )
  const titleMatch = TITLE_PATTERN.exec(lines[0] ?? '')
  const statusValue = headerValue(lines, STATUS_PREFIX)
  const updatedValue = headerValue(lines, UPDATED_PREFIX)
  const nextIdsValue = headerValue(lines, NEXT_IDS_PREFIX)
  return {
    slug: titleMatch?.[1] ?? null,
    title: titleMatch?.[2] ?? null,
    status: statusValue === null ? null : parseStatus(statusValue.value),
    statusLine: statusValue === null ? null : statusValue.line,
    updated: updatedValue === null ? null : updatedValue.value.trim(),
    nextIds: nextIdsValue === null ? null : parseNextIds(nextIdsValue.value),
    sections,
    items: parsedLines.flatMap((parsed) => (parsed !== null && parsed.kind === 'item' ? [parsed.item] : [])),
    badLines: parsedLines.flatMap((parsed) =>
      parsed !== null && parsed.kind === 'bad' ? [{ line: parsed.line, text: parsed.text, section: parsed.section }] : []
    ),
    conflictLines: lines.flatMap((line, index) => (isConflictLine(line) ? [{ line: index + 1, text: line }] : [])),
    note: noteSection === null ? null : noteSection.body.join('\n').trim(),
    noteLine: noteSection === null ? null : noteSection.line
  }
}

export const formatNextIds = (ids: NextIds): string => `${NEXT_IDS_PREFIX} c${ids.c} D${ids.D} R${ids.R} S${ids.S}`

const highestOf = (items: readonly Item[]): NextIds => {
  const next = (letter: Letter): number =>
    items.reduce((highest, item) => (item.letter === letter ? Math.max(highest, item.number + 1) : highest), 1)
  return { c: next('c'), D: next('D'), R: next('R'), S: next('S') }
}

export const highestIds = (text: string): NextIds => highestOf(parseDocument(text).items)

export const stripHeaderLines = (text: string): string => {
  const lines = text.split('\n')
  const end = firstHeadingIndex(lines)
  return lines
    .filter((line, index) => index >= end || !(line.startsWith(UPDATED_PREFIX) || line.startsWith(NEXT_IDS_PREFIX)))
    .join('\n')
}

const replaceAt = (lines: readonly string[], index: number, line: string): string[] => [
  ...lines.slice(0, index),
  line,
  ...lines.slice(index + 1)
]

const insertAfter = (lines: readonly string[], index: number, line: string): string[] => [
  ...lines.slice(0, index + 1),
  line,
  ...lines.slice(index + 1)
]

const withHeaderLine = (lines: readonly string[], prefix: string, line: string, anchor: number): string[] => {
  const index = headerIndex(lines, prefix)
  return index < 0 ? insertAfter(lines, anchor, line) : replaceAt(lines, index, line)
}

const updatedAnchor = (lines: readonly string[]): number => {
  const statusIndex = headerIndex(lines, STATUS_PREFIX)
  if (statusIndex >= 0) return statusIndex
  return firstHeadingIndex(lines) > 0 ? 0 : -1
}

export const normaliseDocument = (text: string, opts: { acceptedAt: string; previousNextIds: NextIds }): string => {
  const parsed = parseDocument(text)
  const lines = splitLines(text)
  const kept = parsed.noteLine === null ? lines : dropTrailingBlank(lines.slice(0, parsed.noteLine - 1))
  const highest = highestOf(parsed.items)
  const previous = opts.previousNextIds
  const nextIds: NextIds = {
    c: Math.max(previous.c, highest.c),
    D: Math.max(previous.D, highest.D),
    R: Math.max(previous.R, highest.R),
    S: Math.max(previous.S, highest.S)
  }
  const withUpdated = withHeaderLine(kept, UPDATED_PREFIX, `${UPDATED_PREFIX} ${opts.acceptedAt}`, updatedAnchor(kept))
  const withNextIds = withHeaderLine(
    withUpdated,
    NEXT_IDS_PREFIX,
    formatNextIds(nextIds),
    headerIndex(withUpdated, UPDATED_PREFIX)
  )
  return `${withNextIds.join('\n').replace(/\n+$/, '')}\n`
}

const statusLineText = (text: string, parsed: ParsedDocument): string | null =>
  parsed.statusLine === null ? null : (splitLines(text)[parsed.statusLine - 1] ?? null)

const sectionBodies = (parsed: ParsedDocument, name: string): string[] =>
  parsed.sections.filter((section) => section.name === name).map((section) => dropTrailingBlank(section.body).join('\n'))

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const changedSummary = (oldText: string, newText: string): string => {
  const before = parseDocument(oldText)
  const after = parseDocument(newText)
  const statusChanged = statusLineText(oldText, before) !== statusLineText(newText, after)
  const names = [...new Set([...after.sections, ...before.sections].map((section) => section.name))]
  const changedSections = names.filter((name) => !sameStrings(sectionBodies(before, name), sectionBodies(after, name)))
  const changed = [...(statusChanged ? ['Status'] : []), ...changedSections]
  return changed.length === 0 ? 'changed the title' : `changed ${changed.join(', ')}`
}

export const commitMessage = (slug: string, oldText: string, newText: string): string => {
  const noteLines = dropLeadingBlank((parseDocument(newText).note ?? '').split('\n'))
  const summary = noteLines[0]
  if (summary === undefined) return `update ${slug}: ${changedSummary(oldText, newText)}`
  const further = dropLeadingBlank(noteLines.slice(1))
  const firstLine = `update ${slug}: ${summary.trim()}`
  return further.length === 0 ? firstLine : [firstLine, '', ...further].join('\n')
}
