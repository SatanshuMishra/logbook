import { escapeStored } from '../render/escape.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Criterion, KeyDecision, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'

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

const detailCriterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderDetailCriterionLine = (criterion: Criterion): string =>
  `c${criterion.ordinal} [${detailCriterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${escapeStored(criterion.text)}`

const renderDetailRiskLine = (risk: Risk): string =>
  `- ${escapeStored(risk.id)} [${escapeStored(risk.scope)}] ${escapeStored(risk.text)}`

const renderDetailKeyDecisionLine = (keyDecision: KeyDecision): string =>
  `- ${escapeStored(keyDecision.id)} -> ${escapeStored(keyDecision.decision_id)} [${escapeStored(keyDecision.scope)}] ${escapeStored(keyDecision.title)}`

const renderDetailOutOfScopeLine = (outOfScope: OutOfScope): string =>
  `- ${escapeStored(outOfScope.id)} ${escapeStored(outOfScope.text)}`

const renderDetailDanglingLine = (decisionId: string): string => `dangling: ${escapeStored(decisionId)}`

const renderDetailQuarantinedLine = (decisionId: string): string => `quarantined: ${escapeStored(decisionId)}`

const renderDetailRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${escapeStored(predecessor.title)} (${escapeStored(predecessor.slug)})`

const renderDetailBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? 'Blockage: none' : `Blocked: ${escapeStored(blockedBy)}`

const renderDetailPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? 'Currently being worked: yes' : 'Currently being worked: no'

export const renderThreadDetail = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null
): string => {
  const criteriaLines = thread.completion_criteria.map(renderDetailCriterionLine)
  const riskLines = thread.spine.open_risks.map(renderDetailRiskLine)
  const keyDecisionLines = thread.spine.key_decisions.map(renderDetailKeyDecisionLine)
  const outOfScopeLines = thread.spine.out_of_scope.map(renderDetailOutOfScopeLine)
  const danglingLines = decisionIntegrity.dangling.map(renderDetailDanglingLine)
  const quarantinedLines = decisionIntegrity.quarantined.map(renderDetailQuarantinedLine)
  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderDetailRelatedLine)

  return [
    `Thread: ${escapeStored(thread.title)}`,
    `Id: ${escapeStored(thread.id)}`,
    `Status: ${escapeStored(thread.status)}`,
    renderDetailBlockage(thread.blocked_by),
    renderDetailPointerStatus(pointer, thread.id),
    `Active goal: ${escapeStored(thread.spine.active_goal)}`,
    `Next step: ${escapeStored(thread.spine.next_step)}`,
    `Last session: ${escapeStored(thread.spine.last_session)}`,
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
    'Decisions:',
    `resolved: ${decisionIntegrity.resolved}`,
    ...danglingLines,
    ...quarantinedLines
  ].join('\n')
}
