import { escapeStored } from '../render/escape.ts'
import { clipWithMarker } from '../render/clip.ts'
import type { Binding } from '../schema/binding.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Artifact, Criterion, KeyDecision, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'

export type BindingIntegrity = { bound: Binding[]; unreadable: number; unread: boolean }

export type SessionsListing = {
  threadId: string
  entries: SessionEntry[]
  quarantined: string[]
  threadQuarantinedReason: string | null
}

const NOT_RECORDED = 'not recorded'
const STORED_LINE_BREAK = 'U+000A'
const SESSION_FIRST_LINE_MAX = 200
export const SESSION_FIRST_LINE_ENTRIES_MAX = 50
const SESSION_FIRST_LINE_CLIPPED_NOTE =
  'some entry first lines were shortened to fit this listing; read the entry in full for the rest'
const BINDINGS_UNREAD_NOTE = 'bindings could not be read; none is claimed either way'

const renderCommitLine = (commit: string | null): string =>
  typeof commit !== 'string' ? 'Commit: unknown' : 'Commit: ' + escapeStored(commit)

const renderSupersedesLine = (supersedes: readonly string[]): string =>
  supersedes.length === 0
    ? 'Supersedes: none'
    : ['Supersedes:', supersedes.map((id) => escapeStored(id)).join(', ')].join(' ')

export const renderDecisionResource = (decision: Decision): string =>
  [
    `Decision: ${escapeStored(decision.title)}`,
    `Thread: ${escapeStored(decision.thread_id)}`,
    `Context: ${escapeStored(decision.context)}`,
    'Options:',
    ...decision.options.map((option) => `- ${escapeStored(option)}`),
    `Outcome: ${escapeStored(decision.outcome)}`,
    renderCommitLine(decision.commit),
    renderSupersedesLine(decision.supersedes),
    `Recorded: ${escapeStored(decision.created_at)}`
  ].join('\n')

export const renderSessionEntryResource = (entry: SessionEntry): string =>
  [
    `Session entry: ${escapeStored(entry.id)}`,
    `Thread: ${escapeStored(entry.thread_id)}`,
    `Actor: ${escapeStored(entry.actor)}`,
    `Recorded: ${escapeStored(entry.created_at)}`,
    '',
    escapeStored(entry.body)
  ].join('\n')

const renderDetailQuarantinedLine = (id: string): string => `quarantined: ${escapeStored(id)}`

const firstStoredLine = (body: string): string => body.split(STORED_LINE_BREAK)[0] ?? ''

const renderSessionsEntryLine = (entry: SessionEntry, includeFirstLine: boolean): string =>
  includeFirstLine
    ? `- ${escapeStored(entry.id)} [${escapeStored(entry.created_at)}] ${clipWithMarker(escapeStored(firstStoredLine(entry.body)), SESSION_FIRST_LINE_MAX)}`
    : `- ${escapeStored(entry.id)} [${escapeStored(entry.created_at)}]`

const firstLineWasClipped = (entry: SessionEntry): boolean => {
  const escaped = escapeStored(firstStoredLine(entry.body))
  return clipWithMarker(escaped, SESSION_FIRST_LINE_MAX) !== escaped
}

const renderSessionsDroppedFirstLinesNote = (count: number, threadId: string): string =>
  `${count} entry first line${count === 1 ? '' : 's'} omitted to fit this listing; read one in full at logbook://session/${escapeStored(threadId)}/{entry_id}`

const renderSessionsThreadQuarantinedLine = (reason: string): string =>
  `thread record quarantined: ${escapeStored(reason)}`

export const renderSessionsResource = (listing: SessionsListing): string => {
  const count = listing.entries.length
  const shownFirstLine = listing.entries.slice(0, SESSION_FIRST_LINE_ENTRIES_MAX)
  const droppedFirstLine = listing.entries.slice(SESSION_FIRST_LINE_ENTRIES_MAX)

  const quarantinedThreadLines = [listing.threadQuarantinedReason]
    .filter((reason): reason is string => reason !== null)
    .map((reason) => renderSessionsThreadQuarantinedLine(reason))

  const droppedFirstLineLines = [droppedFirstLine.length]
    .filter((droppedCount) => droppedCount > 0)
    .map((droppedCount) => renderSessionsDroppedFirstLinesNote(droppedCount, listing.threadId))

  return [
    `Sessions: ${count} entr${count === 1 ? 'y' : 'ies'} for thread ${escapeStored(listing.threadId)}`,
    ...quarantinedThreadLines,
    ...shownFirstLine.map((entry) => renderSessionsEntryLine(entry, true)),
    ...droppedFirstLine.map((entry) => renderSessionsEntryLine(entry, false)),
    ...listing.quarantined.map(renderDetailQuarantinedLine),
    ...shownFirstLine.filter(firstLineWasClipped).slice(0, 1).map(() => SESSION_FIRST_LINE_CLIPPED_NOTE),
    ...droppedFirstLineLines,
    `Read one in full at logbook://session/${escapeStored(listing.threadId)}/{entry_id}`
  ].join('\n')
}

const detailCriterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderDetailCriterionCheckLine = (criterion: Criterion): string =>
  `  check: ${typeof criterion.check === 'string' ? escapeStored(criterion.check) : NOT_RECORDED}`

const renderDetailCriterionResultLine = (criterion: Criterion): string => {
  if (typeof criterion.result !== 'string') return `  result: ${NOT_RECORDED}`
  const status = typeof criterion.result_status === 'string' ? escapeStored(criterion.result_status) : NOT_RECORDED
  return `  result: ${escapeStored(criterion.result)} (${status})`
}

const renderDetailCriterionLine = (criterion: Criterion): string =>
  [
    `c${criterion.ordinal} [${detailCriterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${escapeStored(criterion.text)}`,
    renderDetailCriterionCheckLine(criterion),
    ...[criterion].filter((entry) => entry.done).map((entry) => renderDetailCriterionResultLine(entry))
  ].join('\n')

const renderDetailArtifactLine = (artifact: Artifact): string =>
  `- ${escapeStored(artifact.id)} ${escapeStored(artifact.label)} -> ${escapeStored(artifact.pointer)}`

const renderDetailBindingLine = (binding: Binding): string =>
  `- ${escapeStored(binding.id)} ${escapeStored(binding.branch)}`

const renderDetailRiskLine = (risk: Risk): string =>
  `- ${escapeStored(risk.id)} [${escapeStored(risk.scope)}] ${escapeStored(risk.text)}`

const renderDetailKeyDecisionLine = (keyDecision: KeyDecision): string =>
  `- ${escapeStored(keyDecision.id)} -> ${escapeStored(keyDecision.decision_id)} [${escapeStored(keyDecision.scope)}] ${escapeStored(keyDecision.title)}`

const renderDetailOutOfScopeLine = (outOfScope: OutOfScope): string =>
  `- ${escapeStored(outOfScope.id)} ${escapeStored(outOfScope.text)}`

const renderDetailDanglingLine = (decisionId: string): string => `dangling: ${escapeStored(decisionId)}`

const renderDetailRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${escapeStored(predecessor.title)} (${escapeStored(predecessor.slug)})`

const renderDetailBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? 'Blockage: none' : `Blocked: ${escapeStored(blockedBy)}`

const renderDetailPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? 'Currently being worked: yes' : 'Currently being worked: no'

const renderDetailLastSessionNote = (threadId: string): string =>
  `(park_thread no longer writes this field; see logbook://sessions/${escapeStored(threadId)} for the recorded session log)`

export const renderThreadDetail = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  bindings: BindingIntegrity
): string => {
  const criteriaLines = thread.completion_criteria.map(renderDetailCriterionLine)
  const artifactLines = (thread.artifacts ?? []).map(renderDetailArtifactLine)
  const riskLines = thread.spine.open_risks.map(renderDetailRiskLine)
  const keyDecisionLines = thread.spine.key_decisions.map(renderDetailKeyDecisionLine)
  const outOfScopeLines = thread.spine.out_of_scope.map(renderDetailOutOfScopeLine)
  const danglingLines = decisionIntegrity.dangling.map(renderDetailDanglingLine)
  const quarantinedLines = decisionIntegrity.quarantined.map(renderDetailQuarantinedLine)
  const bindingLines = bindings.bound.map(renderDetailBindingLine)
  const bindingUnreadableLines = [bindings.unreadable]
    .filter((count) => count > 0)
    .map((count) => `unreadable binding records: ${count}`)
  const bindingUnreadLines = [bindings.unread].filter(Boolean).map(() => BINDINGS_UNREAD_NOTE)
  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderDetailRelatedLine)
  const lastSessionNoteLines = [thread.spine.last_session]
    .filter((value) => value.length > 0)
    .map(() => renderDetailLastSessionNote(thread.id))

  return [
    `Thread: ${escapeStored(thread.title)}`,
    `Id: ${escapeStored(thread.id)}`,
    `Slug: ${escapeStored(thread.slug)}`,
    `Status: ${escapeStored(thread.status)}`,
    renderDetailBlockage(thread.blocked_by),
    renderDetailPointerStatus(pointer, thread.id),
    `Active goal: ${escapeStored(thread.spine.active_goal)}`,
    `Next step: ${escapeStored(thread.spine.next_step)}`,
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    ...lastSessionNoteLines,
    'Artifacts:',
    ...artifactLines,
    'Related:',
    ...relatedLines,
    'Completion criteria:',
    ...criteriaLines,
    'Open risks:',
    ...riskLines,
    'Key decisions:',
    ...keyDecisionLines,
    'Out of scope:',
    ...outOfScopeLines,
    'Bindings:',
    ...bindingLines,
    ...bindingUnreadableLines,
    ...bindingUnreadLines,
    'Decisions:',
    `resolved: ${decisionIntegrity.resolved}`,
    ...danglingLines,
    ...quarantinedLines
  ].join('\n')
}
