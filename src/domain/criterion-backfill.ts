import type { Criterion, KeyDecision, Risk, Thread } from '../schema/thread.ts'

const SCOPE_ORDINAL_PATTERN = /^criterion\s+(\d+)$/i

export const criterionIdForScope = (scope: string, criteria: readonly Criterion[]): Criterion['id'] | undefined => {
  const match = SCOPE_ORDINAL_PATTERN.exec(scope.trim())
  if (match === null) return undefined
  const ordinalText = match[1]
  if (ordinalText === undefined) return undefined
  const ordinal = Number(ordinalText)
  const criterion = criteria.find((candidate) => candidate.ordinal === ordinal)
  return criterion?.id
}

const backfillRisk = (risk: Risk, criteria: readonly Criterion[]): Risk => {
  if (risk.criterion_id !== undefined) return risk
  const criterionId = criterionIdForScope(risk.scope, criteria)
  return criterionId === undefined ? risk : { ...risk, criterion_id: criterionId }
}

const backfillKeyDecision = (link: KeyDecision, criteria: readonly Criterion[]): KeyDecision => {
  if (link.criterion_id !== undefined) return link
  const criterionId = criterionIdForScope(link.scope, criteria)
  return criterionId === undefined ? link : { ...link, criterion_id: criterionId }
}

export const backfillCriterionIds = (thread: Thread): Thread => ({
  ...thread,
  spine: {
    ...thread.spine,
    open_risks: thread.spine.open_risks.map((risk) => backfillRisk(risk, thread.completion_criteria)),
    key_decisions: thread.spine.key_decisions.map((link) => backfillKeyDecision(link, thread.completion_criteria))
  }
})
