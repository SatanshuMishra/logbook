import type { Thread, Criterion, Risk, OutOfScope, Artifact } from '../schema/thread.ts'
import { criterionReopenedBy, criterionSettledness, nextStepAnchor, riskAnchor } from '../schema/thread.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Decision } from '../schema/decision.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { Store } from '../store/records.ts'
import {
  indexRecords,
  matchByFileName,
  resolveRecordIds,
  type IndexedRecord,
  type searchRecords
} from '../domain/record-index.ts'
import { escapeStored, escapeStoredBlock, firstNonEmptyStoredLine } from './escape.ts'
import { clipWithMarker } from './clip.ts'

const FORMER_HEADER_FIELD_WRITE_MAX = 500

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

export const BRIEFING_HEADING = '# Your Preflight Briefing'

const HEADER_FIELD_ESCAPED_GRAPHEME_MAX = FORMER_HEADER_FIELD_WRITE_MAX

const NOT_RECORDED = 'not recorded'

export const BRIEFING_HEAD_ONLY_LINE =
  '- this session has already seen this thread, so only the head of the briefing is shown'

const OTHER_RECORDS_HEADING =
  '**Other records on this thread** (one line each; name one in a next step to see it in full, or read a decision at logbook://decision/{id}):'

const NO_OTHER_RECORDS_LINE = '- none'

const OTHER_THREADS_LINE =
  '**Other threads:** search_ledger lists and searches the records on every thread, closed ones included.'

const clip = (text: string, max: number): string => clipWithMarker(escapeStored(text), max)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  if (criterion.done) return 'done'
  return criterionReopenedBy(criterion) !== null ? 'reopened' : 'open'
}

const settlednessLabel = (criterion: Criterion): string => {
  const settledness = criterionSettledness(criterion)
  switch (settledness) {
    case 'confirmed':
      return 'confirmed'
    case 'proposed':
      return 'proposed'
    case 'unsettled':
      return 'unsettled'
    default: {
      const exhaustive: never = settledness
      throw new Error(
        `settlednessLabel received a criterion settledness it does not recognise: ${escapeStored(String(exhaustive))}.`
      )
    }
  }
}

const renderResultStatus = (criterion: Criterion): string => escapeStored(criterion.result_status ?? NOT_RECORDED)

const renderUnreadableSessionEntriesLine = (count: number, threadId: string): string =>
  `- ${count} session log entr${count === 1 ? 'y' : 'ies'} on this thread could not be read; see logbook://sessions/${escapeStored(threadId)} for the complete record`

const renderUnreadableDecisionsHandleLine = (count: number): string =>
  `- ${count} linked decision record${count === 1 ? '' : 's'} could not be read`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${clip(blockedBy, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)}`

const renderWholeBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

export const renderHandle = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  unreadableSessionEntryCount: number
): string => {
  const unstruck = thread.completion_criteria.filter((criterion) => criterion.struck_by === null)
  const doneCount = unstruck.filter((criterion) => criterion.done).length
  const unreadableDecisionCount = decisionIntegrity.dangling.length + decisionIntegrity.quarantined.length
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]
  const notShownBulletLines = [
    BRIEFING_HEAD_ONLY_LINE,
    ...[unreadableDecisionCount].filter((count) => count > 0).map(renderUnreadableDecisionsHandleLine),
    ...[unreadableSessionEntryCount]
      .filter((count) => count > 0)
      .map((count) => renderUnreadableSessionEntriesLine(count, thread.id))
  ]

  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${clip(thread.title, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    `**Criteria:** ${doneCount} of ${unstruck.length} done`,
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStoredBlock(value)),
    '',
    '**Not shown:**',
    ...notShownBulletLines,
    `See logbook://thread/${escapeStored(thread.id)} for the complete record.`
  ].join('\n')
}

const STEP_NAMES_NO_RECORDS = 'This step names no records.'

const RECORDS_THIS_STEP_NEEDS = 'Records this step needs:'

const SEARCH_MISS_PROVES_NOTHING =
  'A text search finds only records containing those exact characters; a record that says the same thing in other words is not returned, so finding nothing proves nothing. Search again with other words, or list by kind or thread to see everything.'

const renderRecordPlace = (record: IndexedRecord): string =>
  `thread ${escapeStored(record.threadSlug)}, ${escapeStored(record.threadStatus)}`

const renderSupersedingIds = (record: IndexedRecord): string =>
  record.supersededBy.map((id) => escapeStored(id)).join(', ')

const renderSupersededClause = (record: IndexedRecord): string =>
  record.supersededBy.length === 0 ? '' : `, superseded by ${renderSupersedingIds(record)}`

const renderSupersededSuffix = (record: IndexedRecord): string =>
  record.supersededBy.length === 0 ? '' : ` (superseded by ${renderSupersedingIds(record)})`

const renderRiskBearsOn = (risk: Risk): string => {
  const anchor = riskAnchor(risk)
  return anchor === null ? 'Bears on: the whole thread' : `Bears on: criterion ${escapeStored(anchor)}`
}

const renderRiskBearsOnHeadline = (risk: Risk): string => {
  const anchor = riskAnchor(risk)
  return anchor === null ? '(bears on the whole thread)' : `(bears on criterion ${escapeStored(anchor)})`
}

const renderDecisionFull = (record: IndexedRecord, decision: Decision): string =>
  [
    `Decision ${escapeStored(record.id)} (${renderRecordPlace(record)})${renderSupersededClause(record)}`,
    `Title: ${escapeStored(decision.title)}`,
    `Context: ${escapeStored(decision.context)}`,
    'Options:',
    ...decision.options.map((option) => `- ${escapeStored(option)}`),
    `Outcome: ${escapeStored(decision.outcome)}`
  ].join('\n')

const renderRiskFull = (record: IndexedRecord, risk: Risk): string =>
  [
    `Risk ${escapeStored(record.id)} (${renderRecordPlace(record)}), ${risk.retired ? 'retired' : 'live'}: ${escapeStored(risk.text)}`,
    `Scope: ${escapeStored(risk.scope)}`,
    renderRiskBearsOn(risk),
    ...(risk.refs.length === 0 ? [] : [`Refs: ${risk.refs.map((ref) => escapeStored(ref)).join(', ')}`])
  ].join('\n')

const renderCriterionFull = (record: IndexedRecord, criterion: Criterion): string =>
  [
    `Criterion ${escapeStored(record.id)} (${renderRecordPlace(record)}), c${criterion.ordinal} ${criterionStatus(criterion)}, ${settlednessLabel(criterion)}: ${escapeStored(criterion.text)}`,
    ...(typeof criterion.check === 'string' ? [`Check: ${escapeStored(criterion.check)}`] : []),
    ...((criterion.done || criterionReopenedBy(criterion) !== null) && typeof criterion.result === 'string'
      ? [`Result: ${escapeStored(criterion.result)} (${renderResultStatus(criterion)})`]
      : []),
    ...(criterionSettledness(criterion) === 'confirmed' && typeof criterion.settled_by === 'string'
      ? [`Settled by: ${escapeStored(criterion.settled_by)}`]
      : [])
  ].join('\n')

const renderEntryFull = (record: IndexedRecord, entry: SessionEntry): string =>
  [
    `Session entry ${escapeStored(record.id)} (${renderRecordPlace(record)}, by ${escapeStored(entry.actor, 'paren-wrapped')})`,
    escapeStoredBlock(entry.body)
  ].join('\n')

const renderArtifactFull = (record: IndexedRecord, artifact: Artifact): string =>
  `Artifact ${escapeStored(record.id)} (${renderRecordPlace(record)})${artifact.retired ? ', retired' : ''}: ${escapeStored(artifact.label)} -> ${escapeStored(artifact.pointer)}`

const renderOutOfScopeFull = (record: IndexedRecord, note: OutOfScope): string =>
  `Out of scope ${escapeStored(record.id)} (${renderRecordPlace(record)}): ${escapeStored(note.text)}`

const unrecognisedRecordKind = (record: never): Error =>
  new Error(
    `a record renderer received a record kind it does not recognise: ${escapeStored(String((record as { kind: unknown }).kind))}.`
  )

export const renderRecordFull = (record: IndexedRecord): string => {
  switch (record.kind) {
    case 'decision':
      return renderDecisionFull(record, record.decision)
    case 'risk':
      return renderRiskFull(record, record.risk)
    case 'criterion':
      return renderCriterionFull(record, record.criterion)
    case 'entry':
      return renderEntryFull(record, record.entry)
    case 'artifact':
      return renderArtifactFull(record, record.artifact)
    case 'out-of-scope':
      return renderOutOfScopeFull(record, record.note)
    default:
      throw unrecognisedRecordKind(record)
  }
}

const renderHeadlineText = (text: string): string => escapeStored(firstNonEmptyStoredLine(text))

const renderCriterionHeadline = (criterion: Criterion): string =>
  `c${criterion.ordinal} [${criterionStatus(criterion)}] [${settlednessLabel(criterion)}] ${renderHeadlineText(criterion.text)}`

export const renderRecordHeadline = (record: IndexedRecord): string => {
  switch (record.kind) {
    case 'decision':
      return renderHeadlineText(record.decision.title)
    case 'risk':
      return `${renderHeadlineText(record.risk.text)} ${renderRiskBearsOnHeadline(record.risk)}`
    case 'criterion':
      return renderCriterionHeadline(record.criterion)
    case 'entry':
      return renderHeadlineText(record.entry.body)
    case 'artifact':
      return `${renderHeadlineText(record.artifact.label)} -> ${escapeStored(record.artifact.pointer)}`
    case 'out-of-scope':
      return renderHeadlineText(record.note.text)
    default:
      throw unrecognisedRecordKind(record)
  }
}

export const renderRecordsInFull = (
  named: readonly IndexedRecord[],
  matched: readonly { path: string; record: IndexedRecord }[]
): string => {
  const namedSection =
    named.length === 0
      ? STEP_NAMES_NO_RECORDS
      : [RECORDS_THIS_STEP_NEEDS, ...named.map((record) => renderRecordFull(record))].join('\n\n')
  const matchedPaths = [...new Set(matched.map((match) => match.path))]
  const matchedSections = matchedPaths.map((matchedPath) =>
    [
      `Matched by file name, because this step names ${escapeStored(matchedPath)}:`,
      ...matched.filter((match) => match.path === matchedPath).map((match) => renderRecordFull(match.record))
    ].join('\n\n')
  )
  return [namedSection, ...matchedSections].join('\n\n')
}

const stepRecordIds = (thread: Thread): string[] => {
  const criterionId = nextStepAnchor(thread.spine)
  return [...(thread.spine.next_step_records ?? []), ...(criterionId === null ? [] : [criterionId])]
}

const renderOtherRecordLine = (record: IndexedRecord): string =>
  `- ${escapeStored(record.kind)} ${escapeStored(record.id)}: ${renderRecordHeadline(record)}`

const UNREADABLE_RECORDS_HEADING = '**Unreadable records:**'

const renderDanglingLine = (decisionId: string): string => `- dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `- quarantined: ${escapeStored(decisionId)}`

const renderUnreadableNamedLine = (ids: readonly string[]): string =>
  `Named by this step but not readable now: ${ids.map((id) => escapeStored(id)).join(', ')}`

export const renderStepBriefing = (
  store: Store,
  thread: Thread,
  pointer: Pointer | null,
  decisionIntegrity: DecisionIntegrity,
  unreadableSessionEntryCount: number
): string => {
  const index = indexRecords(store)
  const resolved = resolveRecordIds(index, stepRecordIds(thread))
  const named = resolved.found
  const unreadableNamedLines = resolved.missing.length === 0 ? [] : ['', renderUnreadableNamedLine(resolved.missing)]
  const unreadableLines = [
    ...[decisionIntegrity.dangling.length + decisionIntegrity.quarantined.length]
      .filter((count) => count > 0)
      .map(renderUnreadableDecisionsHandleLine),
    ...decisionIntegrity.dangling.map(renderDanglingLine),
    ...decisionIntegrity.quarantined.map(renderQuarantinedLine),
    ...[unreadableSessionEntryCount]
      .filter((count) => count > 0)
      .map((count) => renderUnreadableSessionEntriesLine(count, thread.id))
  ]
  const unreadableSection = unreadableLines.length === 0 ? [] : ['', UNREADABLE_RECORDS_HEADING, '', ...unreadableLines]
  const namedIds = new Set(named.map((record) => record.id))
  const matched = matchByFileName(index, thread.spine.next_step, namedIds)
  const shownIds = new Set([...namedIds, ...matched.map((match) => match.record.id)])
  const threadRecords = index.filter((record) => record.threadId === thread.id)
  const otherRecords = threadRecords.filter(
    (record) => record.live && record.kind !== 'entry' && !shownIds.has(record.id)
  )
  const otherRecordLines =
    otherRecords.length === 0 ? [NO_OTHER_RECORDS_LINE] : otherRecords.map((record) => renderOtherRecordLine(record))
  const entryCount = threadRecords.filter((record) => record.kind === 'entry').length

  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${escapeStored(thread.title)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderWholeBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    '',
    '**Goal:**',
    '',
    escapeStoredBlock(thread.spine.active_goal),
    '',
    '**Next step:**',
    '',
    escapeStoredBlock(thread.spine.next_step),
    '',
    '**What this step needs:**',
    '',
    renderRecordsInFull(named, matched),
    ...unreadableNamedLines,
    '',
    OTHER_RECORDS_HEADING,
    '',
    ...otherRecordLines,
    ...unreadableSection,
    '',
    `**Session log:** ${entryCount} entries at logbook://sessions/${escapeStored(thread.id)}`,
    '',
    OTHER_THREADS_LINE
  ].join('\n')
}

const renderSearchLine = (record: IndexedRecord): string =>
  `- ${escapeStored(record.kind)} ${escapeStored(record.id)} [${escapeStored(record.threadSlug)}, ${escapeStored(record.threadStatus)}] ${renderRecordHeadline(record)}${renderSupersededSuffix(record)}`

export const renderSearch = (result: ReturnType<typeof searchRecords>): string =>
  [
    `${result.records.length} of ${result.searched} records match, across ${result.threads} threads, closed threads included.`,
    ...result.records.map((record) => renderSearchLine(record)),
    ...(result.missProvesNothing ? [SEARCH_MISS_PROVES_NOTHING] : [])
  ].join('\n')
