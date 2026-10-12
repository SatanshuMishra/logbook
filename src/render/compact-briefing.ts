import type { Thread } from '../schema/thread.ts'
import type { IndexedRecord, RecordKind } from '../domain/record-index.ts'
import { renderRecordFull, renderRecordHeadline } from './briefing.ts'
import { displayStored, displayStoredBlock, escapeStored } from './escape.ts'
import { clipCodeUnitsWithMarker, HOOK_CONTEXT_MAX_CODE_UNITS } from './clip.ts'

export const COMPACT_BRIEFING_HEADING = '# Logbook: the thread this session holds'

export const HEADLINE_LINE_MAX_CODE_UNITS = 200

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

type Count = { shortened: number; cut: number; leftOut: number }

type Tally = {
  records: ReadonlyMap<RecordKind, Count>
  unreadable: number
  fields: readonly FieldName[]
}

type Entry =
  | { type: 'record'; record: IndexedRecord; full: boolean; line: string; whole: string; keepAfter: number }
  | { type: 'unreadable'; ids: readonly string[] }

type RecordEntry = Extract<Entry, { type: 'record' }>

type Section = { heading: string; empty: string; entries: readonly Entry[] }

type PieceType = 'heading' | 'full' | 'line'

type CutLine = { at: number; whole: string; extra: number; record: IndexedRecord; counted: boolean }

type Fill = {
  pieces: readonly string[]
  last: PieceType | null
  remaining: number
  headlinesOnly: boolean
  tally: Tally
  cuts: readonly CutLine[]
}

type Placing = { fill: Fill; headed: boolean }

type Run = { used: number; open: boolean }

const SECTION_BREAK = '\n\n'
const LINE_BREAK = '\n'
const STEP_RECORDS_HEADING = 'Records this step needs:'
const GOAL_LABEL = `${SECTION_BREAK}Goal:${SECTION_BREAK}`
const NEXT_STEP_LABEL = `${SECTION_BREAK}Next step:${SECTION_BREAK}`
const DECISION_ADDRESS = 'logbook://decision/<id>'
const SEARCH_TOOL = 'search_ledger'

const KIND_ORDER: readonly RecordKind[] = ['decision', 'risk', 'criterion', 'artifact', 'out-of-scope', 'entry']

const LINE_ONLY_KINDS: ReadonlySet<RecordKind> = new Set(['criterion', 'decision', 'risk'])

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
    ...(count.cut > 0 ? [`${count.cut} ${nounFor(kind, count.cut)} with the headline cut short`] : []),
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
      return count === undefined || count.shortened + count.cut + count.leftOut === 0 ? null : countPhrase(kind, count)
    }),
    ...unreadableParts(tally.unreadable)
  ])

const longest = (texts: readonly string[]): string =>
  texts.reduce((longer, text) => (text.length > longer.length ? text : longer), '')

const worstOmissionLine = (input: CompactBriefingInput): string => {
  const total =
    input.stepRecords.length + input.openCriteria.length + input.decisions.length + input.risks.length + input.unreadableStepIds.length
  const worstCount = (kind: RecordKind, count: number): Count => ({
    shortened: count,
    cut: LINE_ONLY_KINDS.has(kind) ? count : 0,
    leftOut: count
  })
  return (
    omissionText([
      ...fieldParts(FIELD_NAMES, input.thread.id),
      ...kindParts(input.thread.id, (kind) =>
        total === 0 ? null : longest([countPhrase(kind, worstCount(kind, total)), countPhrase(kind, worstCount(kind, 1))])
      ),
      ...unreadableParts(total)
    ]) ?? ''
  )
}

const withRecordCount = (tally: Tally, kind: RecordKind, change: Partial<Count>): Tally => {
  const current = tally.records.get(kind) ?? { shortened: 0, cut: 0, leftOut: 0 }
  const records = new Map(tally.records)
  records.set(kind, {
    shortened: current.shortened + (change.shortened ?? 0),
    cut: current.cut + (change.cut ?? 0),
    leftOut: current.leftOut + (change.leftOut ?? 0)
  })
  return { ...tally, records }
}

const leaveOut = (tally: Tally, entry: Entry): Tally =>
  entry.type === 'unreadable'
    ? { ...tally, unreadable: tally.unreadable + entry.ids.length }
    : withRecordCount(tally, entry.record.kind, { leftOut: 1 })

const headlineLine = (record: IndexedRecord, width: number): string => {
  const start = `- ${escapeStored(record.kind)} ${escapeStored(record.id)}: `
  return `${start}${clipCodeUnitsWithMarker(renderRecordHeadline(record), Math.max(0, width - start.length))}`
}

const unreadablePiece = (ids: readonly string[]): string =>
  `${SECTION_BREAK}Named by this step but not readable now: ${ids.map((id) => escapeStored(id)).join(', ')}`

const stepRecordLines = (input: CompactBriefingInput, width: number): string[] =>
  input.stepRecords.map((record) => headlineLine(record, width))

const unreadableRoom = (input: CompactBriefingInput): number =>
  input.unreadableStepIds.length === 0 ? 0 : unreadablePiece(input.unreadableStepIds).length

const linesRoomAfterFull = (lines: readonly string[]): number =>
  lines.length === 0
    ? 0
    : SECTION_BREAK.length - LINE_BREAK.length + lines.reduce((sum, line) => sum + LINE_BREAK.length + line.length, 0)

const stepRunCosts = (input: CompactBriefingInput, width: number): number[] => {
  const costs = [
    ...stepRecordLines(input, width).map((line) => LINE_BREAK.length + line.length),
    ...(input.unreadableStepIds.length === 0 ? [] : [unreadableRoom(input)])
  ]
  return costs.map((cost, index) => (index === 0 ? SECTION_BREAK.length + STEP_RECORDS_HEADING.length + cost : cost))
}

const reservedRun = (costs: readonly number[], room: number): number =>
  costs.reduce<Run>(
    (run, cost) => (run.open && run.used + cost <= room ? { used: run.used + cost, open: true } : { used: run.used, open: false }),
    { used: 0, open: true }
  ).used

const lineSeparator = (last: PieceType | null): string => (last === 'heading' || last === 'line' ? LINE_BREAK : SECTION_BREAK)

const push = (fill: Fill, piece: string, type: PieceType): Fill => ({
  ...fill,
  pieces: [...fill.pieces, piece],
  last: type,
  remaining: fill.remaining - piece.length
})

const withCut = (fill: Fill, entry: RecordEntry, line: string, whole: string): Fill =>
  whole === line
    ? fill
    : {
        ...fill,
        cuts: [
          ...fill.cuts,
          { at: fill.pieces.length - 1, whole, extra: whole.length - line.length, record: entry.record, counted: !entry.full }
        ]
      }

const placeEntry = (fill: Fill, entry: Entry, heading: string | null): Fill => {
  const headingPiece = heading === null ? '' : `${SECTION_BREAK}${heading}`
  const afterHeading = heading === null ? fill.last : 'heading'
  const withHeading = (base: Fill): Fill => (heading === null ? base : push(base, headingPiece, 'heading'))
  if (entry.type === 'unreadable') {
    const piece = unreadablePiece(entry.ids)
    if (headingPiece.length + piece.length <= fill.remaining) return push(withHeading(fill), piece, 'full')
    return { ...fill, tally: leaveOut(fill.tally, entry) }
  }
  if (entry.full && !fill.headlinesOnly) {
    const piece = `${SECTION_BREAK}${renderRecordFull(entry.record)}`
    if (headingPiece.length + piece.length + entry.keepAfter <= fill.remaining) return push(withHeading(fill), piece, 'full')
  }
  const separator = lineSeparator(afterHeading)
  const line = `${separator}${entry.line}`
  if (headingPiece.length + line.length > fill.remaining) {
    return { ...fill, headlinesOnly: true, tally: leaveOut(fill.tally, entry) }
  }
  const placed = withCut(push(withHeading({ ...fill, headlinesOnly: true }), line, 'line'), entry, line, `${separator}${entry.whole}`)
  return entry.full ? { ...placed, tally: withRecordCount(placed.tally, entry.record.kind, { shortened: 1 }) } : placed
}

const placeSection = (fill: Fill, section: Section): Fill => {
  if (section.entries.length === 0) {
    const piece = `${SECTION_BREAK}${section.empty}`
    return piece.length <= fill.remaining ? push(fill, piece, 'full') : fill
  }
  return section.entries.reduce<Placing>(
    (placing, entry) => {
      const placed = placeEntry(placing.fill, entry, placing.headed ? null : section.heading)
      return { fill: placed, headed: placing.headed || placed.pieces.length > placing.fill.pieces.length }
    },
    { fill, headed: false }
  ).fill
}

const stepEntries = (input: CompactBriefingInput, width: number): Entry[] => {
  const lines = stepRecordLines(input, width)
  const unreadable = unreadableRoom(input)
  return [
    ...input.stepRecords.map(
      (record, index): Entry => ({
        type: 'record',
        record,
        full: true,
        line: lines[index] ?? '',
        whole: headlineLine(record, Number.POSITIVE_INFINITY),
        keepAfter: linesRoomAfterFull(lines.slice(index + 1)) + unreadable
      })
    ),
    ...(input.unreadableStepIds.length > 0 ? [{ type: 'unreadable', ids: input.unreadableStepIds } as const] : [])
  ]
}

const headlineEntries = (records: readonly IndexedRecord[], width: number): Entry[] =>
  records.map(
    (record): Entry => ({
      type: 'record',
      record,
      full: false,
      line: headlineLine(record, width),
      whole: headlineLine(record, Number.POSITIVE_INFINITY),
      keepAfter: 0
    })
  )

const sectionsOf = (input: CompactBriefingInput, width: number): Section[] => [
  {
    heading: STEP_RECORDS_HEADING,
    empty: 'This step names no records.',
    entries: stepEntries(input, width)
  },
  {
    heading: 'Open criteria:',
    empty: 'Open criteria: none.',
    entries: headlineEntries(input.openCriteria, width)
  },
  {
    heading: 'Live decisions on this thread, newest first:',
    empty: 'Live decisions on this thread: none.',
    entries: headlineEntries(input.decisions, width)
  },
  {
    heading: 'Live risks on this thread:',
    empty: 'Live risks on this thread: none.',
    entries: headlineEntries(input.risks, width)
  }
]

const fillBody = (input: CompactBriefingInput, width: number, remaining: number, tally: Tally): Fill =>
  sectionsOf(input, width).reduce(placeSection, {
    pieces: [],
    last: null,
    remaining,
    headlinesOnly: false,
    tally,
    cuts: []
  })

const widenCutLines = (fill: Fill): Fill =>
  fill.cuts.reduce<Fill>(
    (widened, cut) =>
      cut.extra <= widened.remaining
        ? {
            ...widened,
            pieces: widened.pieces.map((piece, index) => (index === cut.at ? cut.whole : piece)),
            remaining: widened.remaining - cut.extra
          }
        : {
            ...widened,
            cuts: [...widened.cuts, cut],
            tally: cut.counted ? withRecordCount(widened.tally, cut.record.kind, { cut: 1 }) : widened.tally
          },
    { ...fill, cuts: [] }
  )

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

export const waterFill = (lengths: readonly number[], total: number): number[] => {
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
  const whole = assemble(
    input,
    fields,
    fillBody(input, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, EMPTY_TALLY).pieces,
    EMPTY_TALLY
  )
  if (whole.length <= budget) return whole

  const reserve = LINE_BREAK.length + worstOmissionLine(input).length
  const fixed =
    headerFixed(input.thread).length + LINE_BREAK.length + GOAL_LABEL.length + NEXT_STEP_LABEL.length + readMore(input).length + reserve
  const floors = fields.reduce((sum, field) => sum + Math.min(field.length, HEADLINE_LINE_MAX_CODE_UNITS), 0)
  const stepRoom = reservedRun(stepRunCosts(input, HEADLINE_LINE_MAX_CODE_UNITS), budget - fixed - floors)
  const allotted = waterFill(
    fields.map((field) => field.length),
    budget - fixed - stepRoom
  )
  const clipped = fields.map((field, index) => clipCodeUnitsWithMarker(field, allotted[index] ?? 0))
  const shortenedFields = FIELD_NAMES.filter((_name, index) => clipped[index] !== fields[index])
  const fieldsLength = clipped.reduce((sum, field) => sum + field.length, 0)
  const body = widenCutLines(
    fillBody(input, HEADLINE_LINE_MAX_CODE_UNITS, budget - fixed - fieldsLength, { ...EMPTY_TALLY, fields: shortenedFields })
  )
  return assemble(input, clipped, body.pieces, body.tally)
}
