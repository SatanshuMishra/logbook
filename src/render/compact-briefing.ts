import type { Thread } from '../schema/thread.ts'
import type { IndexedRecord, RecordKind } from '../domain/record-index.ts'
import { renderRecordFull, renderRecordHeadline } from './briefing.ts'
import { displayStored, displayStoredBlock, escapeStored } from './escape.ts'
import { clipCodeUnitsWithMarker, HOOK_CONTEXT_MAX_CODE_UNITS } from './clip.ts'

export const COMPACT_BRIEFING_HEADING = '# Logbook: the thread this session holds'

export type CompactBriefingInput = {
  thread: Thread
  stepRecords: readonly IndexedRecord[]
  unreadableStepIds: readonly string[]
  openCriteria: readonly IndexedRecord[]
  decisions: readonly IndexedRecord[]
  risks: readonly IndexedRecord[]
  entryCount: number
}

type FieldName = 'the title and blockage' | 'the goal' | 'the next step'

type Count = { shortened: number; leftOut: number }

type Tally = {
  records: ReadonlyMap<RecordKind, Count>
  unreadable: number
  fields: readonly FieldName[]
}

type Entry =
  | { type: 'record'; record: IndexedRecord; full: boolean }
  | { type: 'unreadable'; ids: readonly string[] }

type Section = { heading: string; empty: string; entries: readonly Entry[] }

type PieceType = 'heading' | 'full' | 'line'

type Fill = {
  pieces: readonly string[]
  last: PieceType | null
  remaining: number
  headlinesOnly: boolean
  stopped: boolean
  tally: Tally
}

const SECTION_BREAK = '\n\n'
const LINE_BREAK = '\n'
const GOAL_LABEL = `${SECTION_BREAK}Goal:${SECTION_BREAK}`
const NEXT_STEP_LABEL = `${SECTION_BREAK}Next step:${SECTION_BREAK}`
const DECISION_ADDRESS = 'logbook://decision/<id>'
const SEARCH_TOOL = 'search_ledger'

const KIND_ORDER: readonly RecordKind[] = ['decision', 'risk', 'criterion', 'artifact', 'out-of-scope', 'entry']

const KIND_NOUNS: Readonly<Record<RecordKind, { one: string; many: string }>> = {
  decision: { one: 'decision', many: 'decisions' },
  risk: { one: 'risk', many: 'risks' },
  criterion: { one: 'criterion', many: 'criteria' },
  artifact: { one: 'artifact', many: 'artifacts' },
  'out-of-scope': { one: 'out-of-scope note', many: 'out-of-scope notes' },
  entry: { one: 'session entry', many: 'session entries' }
}

const FIELD_NAMES: readonly FieldName[] = ['the title and blockage', 'the goal', 'the next step']

const EMPTY_TALLY: Tally = { records: new Map(), unreadable: 0, fields: [] }

const threadAddress = (threadId: string): string => `logbook://thread/${escapeStored(threadId)}`
const sessionsAddress = (threadId: string): string => `logbook://sessions/${escapeStored(threadId)}`

const addressFor = (kind: RecordKind, threadId: string): string => {
  if (kind === 'decision') return DECISION_ADDRESS
  return kind === 'entry' ? sessionsAddress(threadId) : threadAddress(threadId)
}

const nounFor = (kind: RecordKind, count: number): string => (count === 1 ? KIND_NOUNS[kind].one : KIND_NOUNS[kind].many)

const listed = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`

const countPhrase = (kind: RecordKind, count: Count): string =>
  [
    ...(count.shortened > 0 ? [`${count.shortened} ${nounFor(kind, count.shortened)} shortened to a headline`] : []),
    ...(count.leftOut > 0 ? [`${count.leftOut} ${nounFor(kind, count.leftOut)} left out`] : [])
  ].join(' and ')

const fieldParts = (fields: readonly FieldName[], threadId: string): string[] =>
  fields.length === 0 ? [] : [`${listed(fields)} shortened (${threadAddress(threadId)})`]

const kindParts = (threadId: string, phraseFor: (kind: RecordKind) => string | null): string[] =>
  KIND_ORDER.flatMap((kind) => {
    const phrase = phraseFor(kind)
    return phrase === null ? [] : [`${phrase} (${addressFor(kind, threadId)} or ${SEARCH_TOOL})`]
  })

const unreadableParts = (count: number): string[] =>
  count === 0 ? [] : [`${count} named ${count === 1 ? 'id' : 'ids'} not readable now left out (${SEARCH_TOOL})`]

const omissionText = (parts: readonly string[]): string | null =>
  parts.length === 0 ? null : `Not shown in full, to fit this briefing: ${parts.join('; ')}.`

const omissionLine = (tally: Tally, threadId: string): string | null =>
  omissionText([
    ...fieldParts(tally.fields, threadId),
    ...kindParts(threadId, (kind) => {
      const count = tally.records.get(kind)
      return count === undefined || count.shortened + count.leftOut === 0 ? null : countPhrase(kind, count)
    }),
    ...unreadableParts(tally.unreadable)
  ])

const longest = (texts: readonly string[]): string =>
  texts.reduce((longer, text) => (text.length > longer.length ? text : longer), '')

const worstOmissionLine = (input: CompactBriefingInput): string => {
  const total =
    input.stepRecords.length + input.openCriteria.length + input.decisions.length + input.risks.length + input.unreadableStepIds.length
  return (
    omissionText([
      ...fieldParts(FIELD_NAMES, input.thread.id),
      ...kindParts(input.thread.id, (kind) =>
        total === 0
          ? null
          : longest([countPhrase(kind, { shortened: total, leftOut: total }), countPhrase(kind, { shortened: 1, leftOut: 1 })])
      ),
      ...unreadableParts(total)
    ]) ?? ''
  )
}

const withRecordCount = (tally: Tally, kind: RecordKind, change: Partial<Count>): Tally => {
  const current = tally.records.get(kind) ?? { shortened: 0, leftOut: 0 }
  const records = new Map(tally.records)
  records.set(kind, {
    shortened: current.shortened + (change.shortened ?? 0),
    leftOut: current.leftOut + (change.leftOut ?? 0)
  })
  return { ...tally, records }
}

const leaveOut = (tally: Tally, entry: Entry): Tally =>
  entry.type === 'unreadable'
    ? { ...tally, unreadable: tally.unreadable + entry.ids.length }
    : withRecordCount(tally, entry.record.kind, { leftOut: 1 })

const headlineLine = (record: IndexedRecord): string =>
  `- ${escapeStored(record.kind)} ${escapeStored(record.id)}: ${renderRecordHeadline(record)}`

const unreadableLine = (ids: readonly string[]): string =>
  `Named by this step but not readable now: ${ids.map((id) => escapeStored(id)).join(', ')}`

const lineSeparator = (last: PieceType | null): string => (last === 'heading' || last === 'line' ? LINE_BREAK : SECTION_BREAK)

const push = (fill: Fill, piece: string, type: PieceType): Fill => ({
  ...fill,
  pieces: [...fill.pieces, piece],
  last: type,
  remaining: fill.remaining - piece.length
})

const placeEntry = (fill: Fill, entry: Entry, heading: string | null): Fill => {
  if (fill.stopped) return { ...fill, tally: leaveOut(fill.tally, entry) }
  const headingPiece = heading === null ? '' : `${SECTION_BREAK}${heading}`
  const afterHeading = heading === null ? fill.last : 'heading'
  const withHeading = (base: Fill): Fill => (heading === null ? base : push(base, headingPiece, 'heading'))
  if (entry.type === 'unreadable') {
    const piece = `${SECTION_BREAK}${unreadableLine(entry.ids)}`
    if (headingPiece.length + piece.length <= fill.remaining) return push(withHeading(fill), piece, 'full')
    return { ...fill, stopped: true, tally: leaveOut(fill.tally, entry) }
  }
  if (entry.full && !fill.headlinesOnly) {
    const piece = `${SECTION_BREAK}${renderRecordFull(entry.record)}`
    if (headingPiece.length + piece.length <= fill.remaining) return push(withHeading(fill), piece, 'full')
  }
  const line = `${lineSeparator(afterHeading)}${headlineLine(entry.record)}`
  if (headingPiece.length + line.length > fill.remaining) {
    return { ...fill, stopped: true, headlinesOnly: true, tally: leaveOut(fill.tally, entry) }
  }
  const placed = push(withHeading({ ...fill, headlinesOnly: true }), line, 'line')
  return entry.full ? { ...placed, tally: withRecordCount(placed.tally, entry.record.kind, { shortened: 1 }) } : placed
}

const placeSection = (fill: Fill, section: Section): Fill => {
  if (section.entries.length === 0) {
    if (fill.stopped) return fill
    const piece = `${SECTION_BREAK}${section.empty}`
    return piece.length <= fill.remaining ? push(fill, piece, 'full') : { ...fill, stopped: true }
  }
  return section.entries.reduce(
    (current, entry, index) => placeEntry(current, entry, index === 0 ? section.heading : null),
    fill
  )
}

const sectionsOf = (input: CompactBriefingInput): Section[] => [
  {
    heading: 'Records this step needs:',
    empty: 'This step names no records.',
    entries: [
      ...input.stepRecords.map((record): Entry => ({ type: 'record', record, full: true })),
      ...(input.unreadableStepIds.length > 0 ? [{ type: 'unreadable', ids: input.unreadableStepIds } as const] : [])
    ]
  },
  {
    heading: 'Open criteria:',
    empty: 'Open criteria: none.',
    entries: input.openCriteria.map((record): Entry => ({ type: 'record', record, full: false }))
  },
  {
    heading: 'Live decisions on this thread, newest first:',
    empty: 'Live decisions on this thread: none.',
    entries: input.decisions.map((record): Entry => ({ type: 'record', record, full: false }))
  },
  {
    heading: 'Live risks on this thread:',
    empty: 'Live risks on this thread: none.',
    entries: input.risks.map((record): Entry => ({ type: 'record', record, full: false }))
  }
]

const fillBody = (input: CompactBriefingInput, remaining: number, tally: Tally): Fill =>
  sectionsOf(input).reduce(placeSection, {
    pieces: [],
    last: null,
    remaining,
    headlinesOnly: false,
    stopped: false,
    tally
  })

const headerFixed = (thread: Thread): string =>
  [COMPACT_BRIEFING_HEADING, '', `Thread: ${escapeStored(thread.id)}`, `Status: ${escapeStored(thread.status)}`].join(LINE_BREAK)

const titleAndBlockage = (thread: Thread): string =>
  [
    `Title: ${displayStored(thread.title, 'prose', 'mid-line')}`,
    thread.blocked_by === null ? 'Blockage: none' : `Blocked: ${displayStored(thread.blocked_by, 'prose', 'mid-line')}`
  ].join(LINE_BREAK)

const readMore = (input: CompactBriefingInput): string =>
  [
    `${SECTION_BREAK}Read more:`,
    `- ${threadAddress(input.thread.id)}: the whole thread record`,
    `- ${sessionsAddress(input.thread.id)}: the session log, ${input.entryCount} ${input.entryCount === 1 ? 'entry' : 'entries'}`,
    `- ${DECISION_ADDRESS}: any decision in full`,
    `- ${SEARCH_TOOL}: every other record, on every thread, closed ones included`
  ].join(LINE_BREAK)

const waterFill = (lengths: readonly number[], total: number): number[] => {
  const order = lengths.map((length, index) => ({ length, index })).sort((left, right) => left.length - right.length)
  const allotted = lengths.map(() => 0)
  let left = Math.max(0, total)
  order.forEach((item, position) => {
    const share = Math.floor(left / (order.length - position))
    const take = Math.min(item.length, share)
    allotted[item.index] = take
    left -= take
  })
  return allotted
}

const assemble = (
  input: CompactBriefingInput,
  fields: readonly string[],
  body: readonly string[],
  tally: Tally
): string => {
  const [title = '', goal = '', nextStep = ''] = fields
  const omitted = omissionLine(tally, input.thread.id)
  return [
    headerFixed(input.thread),
    LINE_BREAK,
    title,
    GOAL_LABEL,
    goal,
    NEXT_STEP_LABEL,
    nextStep,
    ...body,
    readMore(input),
    ...(omitted === null ? [] : [LINE_BREAK, omitted])
  ].join('')
}

export const renderCompactBriefing = (input: CompactBriefingInput, budget: number = HOOK_CONTEXT_MAX_CODE_UNITS): string => {
  const fields = [
    titleAndBlockage(input.thread),
    displayStoredBlock(input.thread.spine.active_goal),
    displayStoredBlock(input.thread.spine.next_step)
  ]
  const whole = assemble(input, fields, fillBody(input, Number.POSITIVE_INFINITY, EMPTY_TALLY).pieces, EMPTY_TALLY)
  if (whole.length <= budget) return whole

  const reserve = LINE_BREAK.length + worstOmissionLine(input).length
  const fixed =
    headerFixed(input.thread).length + LINE_BREAK.length + GOAL_LABEL.length + NEXT_STEP_LABEL.length + readMore(input).length + reserve
  const allotted = waterFill(
    fields.map((field) => field.length),
    budget - fixed
  )
  const clipped = fields.map((field, index) => clipCodeUnitsWithMarker(field, allotted[index] ?? 0))
  const shortenedFields = FIELD_NAMES.filter((_name, index) => clipped[index] !== fields[index])
  const fieldsLength = clipped.reduce((sum, field) => sum + field.length, 0)
  const body = fillBody(input, budget - fixed - fieldsLength, { ...EMPTY_TALLY, fields: shortenedFields })
  return assemble(input, clipped, body.pieces, body.tally)
}
