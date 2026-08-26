import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../schema/thread.ts'
import type { Decision } from '../schema/decision.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored } from './escape.ts'

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderCriterionLine = (criterion: Criterion, ordinal: number): string =>
  `c${ordinal} [${criterionStatus(criterion)}] ${escapeStored(criterion.text)}`

const renderRiskLine = (risk: Risk): string => `- ${escapeStored(risk.text)}`

const renderKeyDecisionLine = (keyDecision: KeyDecision): string => `- ${escapeStored(keyDecision.title)}`

const renderOutOfScopeLine = (outOfScope: OutOfScope): string => `- ${escapeStored(outOfScope.text)}`

const renderDecisionLine = (decision: Decision): string =>
  `- ${escapeStored(decision.title)}: ${escapeStored(decision.outcome)}`

const renderRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${escapeStored(predecessor.title)} (${escapeStored(predecessor.slug)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? 'Blockage: none' : `Blocked: ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? 'Currently being worked: yes' : 'Currently being worked: no'

export const renderBriefing = (
  thread: Thread,
  decisions: Decision[],
  pointer: Pointer | null,
  predecessor: Thread | null
): string => {
  const criteriaLines = thread.completion_criteria.map((criterion, index) => renderCriterionLine(criterion, index + 1))
  const riskLines = thread.spine.open_risks.map(renderRiskLine)
  const keyDecisionLines = thread.spine.key_decisions.map(renderKeyDecisionLine)
  const outOfScopeLines = thread.spine.out_of_scope.map(renderOutOfScopeLine)
  const decisionLines = decisions.map(renderDecisionLine)
  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderRelatedLine)

  return [
    `Thread: ${escapeStored(thread.title)}`,
    `Status: ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    `Active goal: ${escapeStored(thread.spine.active_goal)}`,
    `Next step: ${escapeStored(thread.spine.next_step)}`,
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    'Related:',
    ...relatedLines,
    'Open risks:',
    ...riskLines,
    'Key decisions:',
    ...keyDecisionLines,
    'Out of scope:',
    ...outOfScopeLines,
    'Completion criteria:',
    ...criteriaLines,
    'Decisions:',
    ...decisionLines
  ].join('\n')
}
