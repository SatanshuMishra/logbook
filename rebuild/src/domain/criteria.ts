import type { Runtime } from '../runtime/runtime.ts'
import type { Thread, Criterion } from '../schema/thread.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import * as caps from '../schema/caps.ts'
import { escapeStored } from '../render/escape.ts'

export type DecisionResolver = (decisionId: string) => boolean

export type InsertCriterionInput = {
  text: string
  kind: 'planned' | 'detour'
  decisionId: string | null | undefined
  position?: number
}

export type RewriteCriterionInput = {
  criterionId: string
  text: string
  decisionId: string | null | undefined
}

export type StrikeCriterionInput = {
  criterionId: string
  decisionId: string | null | undefined
}

type ResolvedDecision = { ok: true; value: string } | Refusal

const missingDecisionRefusal = (field: string): Refusal => ({
  ok: false,
  field,
  accepted: 'a decision id referencing a decision record recorded on this project',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `${field} is required; amending a completion criterion must resolve to a recorded decision.`
})

const unresolvedDecisionRefusal = (field: string, decisionId: string): Refusal => ({
  ok: false,
  field,
  accepted: 'a decision id that resolves to a stored decision record',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `${field} does not resolve to a stored decision record; received ${decisionId}.`
})

const criterionNotFoundRefusal = (field: string, criterionId: string): Refusal => ({
  ok: false,
  field,
  accepted: 'the id of a criterion present on completion_criteria',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `${field} does not match any criterion on this thread; received ${criterionId}.`
})

const textCapRefusal = (field: string, observed: number, limit: number, remedy: string): Refusal => ({
  ok: false,
  field,
  accepted: `at most ${limit} characters after escaping`,
  example: 'ship the health check before closing this thread',
  retryable: true,
  message: `${field} exceeds its cap of ${limit} characters after escaping; observed ${observed}; remedy: ${remedy}.`
})

const capacityRefusal = (field: string, limit: number, observed: number, remedy: string): Refusal => ({
  ok: false,
  field,
  accepted: `at most ${limit} completion criteria`,
  example: 'strike an existing criterion before inserting another',
  retryable: true,
  message: `${field} is already at its cap of ${limit} completion criteria; observed ${observed}; remedy: ${remedy}.`
})

const retentionCapacityRefusal = (field: string, limit: number, observed: number): Refusal => ({
  ok: false,
  field,
  accepted: `at most ${limit} completion criteria retained on the thread, including struck ones`,
  example: 'open a new thread that references this one instead of inserting another criterion here',
  retryable: false,
  message: `${field} names a thread already carrying ${observed} completion criteria, at its retention cap of ${limit}; struck criteria are retained forever and count toward this cap.`
})

const struckCriterionRefusal = (field: string, criterionId: string): Refusal => ({
  ok: false,
  field,
  accepted: 'the id of a criterion that has not been struck',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `${field} names a struck criterion, which is retained as frozen history and cannot be rewritten; received ${criterionId}.`
})

const positionRefusal = (field: string, length: number): Refusal => ({
  ok: false,
  field,
  accepted: `an integer from 0 to ${length}`,
  example: '0',
  retryable: true,
  message: `${field} must be an integer between 0 and ${length}.`
})

const requireDecision = (field: string, decisionId: string | null | undefined, resolve: DecisionResolver): ResolvedDecision => {
  if (decisionId === null || decisionId === undefined || decisionId.trim().length === 0) {
    return missingDecisionRefusal(field)
  }
  if (!resolve(decisionId)) {
    return unresolvedDecisionRefusal(field, decisionId)
  }
  return { ok: true, value: decisionId }
}

const recomputeOrdinals = (criteria: readonly Criterion[]): Criterion[] =>
  criteria.map((criterion, index) => ({ ...criterion, ordinal: index + 1 }))

export const insertCriterion = (
  rt: Runtime,
  thread: Thread,
  input: InsertCriterionInput,
  resolveDecision: DecisionResolver
): Ok<Thread> | Refusal => {
  const decisionResult = requireDecision('decision_id', input.decisionId, resolveDecision)
  if (!decisionResult.ok) {
    return decisionResult
  }

  const existing = thread.completion_criteria
  const unstruckCount = existing.filter((criterion) => criterion.struck_by === null).length
  if (unstruckCount >= caps.CRITERIA_MAX_ELEMENTS) {
    return capacityRefusal(
      'criteria.insert.completion_criteria',
      caps.CRITERIA_MAX_ELEMENTS,
      unstruckCount,
      'strike an existing criterion before inserting another'
    )
  }
  if (existing.length >= caps.CRITERIA_RETENTION_MAX_ELEMENTS) {
    return retentionCapacityRefusal('thread_id', caps.CRITERIA_RETENTION_MAX_ELEMENTS, existing.length)
  }

  const position = input.position ?? existing.length
  if (!Number.isInteger(position) || position < 0 || position > existing.length) {
    return positionRefusal('criteria.insert.position', existing.length)
  }

  const escapedText = escapeStored(input.text)
  if (escapedText.length > caps.CRITERION_TEXT_MAX) {
    return textCapRefusal(
      'criteria.insert.text',
      escapedText.length,
      caps.CRITERION_TEXT_MAX,
      'shorten the criterion text and retry'
    )
  }

  const inserted: Criterion = {
    id: rt.ulid(),
    ordinal: 0,
    text: escapedText,
    done: false,
    kind: input.kind,
    struck_by: null
  }

  const next = [...existing.slice(0, position), inserted, ...existing.slice(position)]

  return {
    ok: true,
    value: { ...thread, completion_criteria: recomputeOrdinals(next), updated_at: rt.now() }
  }
}

export const rewriteCriterion = (
  rt: Runtime,
  thread: Thread,
  input: RewriteCriterionInput,
  resolveDecision: DecisionResolver
): Ok<Thread> | Refusal => {
  const decisionResult = requireDecision('decision_id', input.decisionId, resolveDecision)
  if (!decisionResult.ok) {
    return decisionResult
  }

  const target = thread.completion_criteria.find((criterion) => criterion.id === input.criterionId)
  if (target === undefined) {
    return criterionNotFoundRefusal('criteria.rewrite.criterion_id', input.criterionId)
  }
  if (target.struck_by !== null) {
    return struckCriterionRefusal('criterion_id', input.criterionId)
  }

  const escapedText = escapeStored(input.text)
  if (escapedText.length > caps.CRITERION_TEXT_MAX) {
    return textCapRefusal(
      'criteria.rewrite.text',
      escapedText.length,
      caps.CRITERION_TEXT_MAX,
      'shorten the criterion text and retry'
    )
  }

  const next = thread.completion_criteria.map((criterion) =>
    criterion.id === input.criterionId ? { ...criterion, text: escapedText } : criterion
  )

  return {
    ok: true,
    value: { ...thread, completion_criteria: recomputeOrdinals(next), updated_at: rt.now() }
  }
}

export const strikeCriterion = (
  rt: Runtime,
  thread: Thread,
  input: StrikeCriterionInput,
  resolveDecision: DecisionResolver
): Ok<Thread> | Refusal => {
  const decisionResult = requireDecision('decision_id', input.decisionId, resolveDecision)
  if (!decisionResult.ok) {
    return decisionResult
  }

  const target = thread.completion_criteria.find((criterion) => criterion.id === input.criterionId)
  if (target === undefined) {
    return criterionNotFoundRefusal('criteria.strike.criterion_id', input.criterionId)
  }

  const decisionId = decisionResult.value
  const next = thread.completion_criteria.map((criterion) =>
    criterion.id === input.criterionId ? { ...criterion, struck_by: decisionId } : criterion
  )

  return {
    ok: true,
    value: { ...thread, completion_criteria: recomputeOrdinals(next), updated_at: rt.now() }
  }
}
