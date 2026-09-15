import type { Ok, Refusal } from '../schema/declare.ts'
import type { Criterion, KeyDecision, OutOfScope, Risk, Spine, Ulid } from '../schema/thread.ts'
import * as caps from '../schema/caps.ts'
import { escapeStored } from '../render/escape.ts'

export type SpineContribution = {
  active_goal?: string
  next_step?: string
  next_step_criterion_id?: Ulid
  landed?: string
  last_session?: string
  open_risks?: Risk[]
  key_decisions?: KeyDecision[]
  out_of_scope?: OutOfScope[]
}

type CollectionField = { [K in keyof Spine]-?: Spine[K] extends unknown[] ? K : never }[keyof Spine]

const COLLECTION_ELEMENTS_CAP: Record<CollectionField, number | null> = {
  open_risks: null,
  key_decisions: caps.KEY_DECISIONS_MAX_ELEMENTS,
  out_of_scope: caps.OUT_OF_SCOPE_MAX_ELEMENTS
}

const CALLER_FIELD: Record<CollectionField, string> = {
  open_risks: 'risks_add',
  key_decisions: 'key_decisions_add',
  out_of_scope: 'out_of_scope_add'
}

const COLLECTION_FIELDS: CollectionField[] = Object.keys(COLLECTION_ELEMENTS_CAP) as CollectionField[]

const capRefusal = (field: string, limit: number, observed: number, unit: string, remedy: string): Refusal => ({
  ok: false,
  field,
  accepted: `at most ${limit} ${unit}`,
  example: `a ${field} contribution within ${limit} ${unit}`,
  retryable: true,
  message: `${field} exceeds its cap of ${limit} ${unit}; observed ${observed} ${unit} for this call; remedy: ${remedy}.`
})

const checkCollectionCount = (field: CollectionField, storedCount: number, contributedCount: number): Refusal | null => {
  const limit = COLLECTION_ELEMENTS_CAP[field]
  if (limit === null) {
    return null
  }
  const observed = storedCount + contributedCount
  if (observed > limit) {
    return capRefusal(
      CALLER_FIELD[field],
      limit,
      observed,
      'entries',
      'split the contribution across multiple calls, or remove existing entries before retrying'
    )
  }
  return null
}

const checkRiskElements = (contributed: Risk[]): Refusal | null => {
  for (const [index, risk] of contributed.entries()) {
    if (risk.refs.length > caps.RISK_REFS_MAX_ELEMENTS) {
      return capRefusal(
        `risks_add[${index}].refs`,
        caps.RISK_REFS_MAX_ELEMENTS,
        risk.refs.length,
        'entries',
        'remove refs and retry'
      )
    }
  }
  return null
}

const checkCollectionField = (field: CollectionField, stored: Spine, contribution: SpineContribution): Refusal | null => {
  if (field === 'open_risks') {
    const contributed = contribution.open_risks
    if (contributed === undefined) {
      return null
    }
    const countRefusal = checkCollectionCount('open_risks', stored.open_risks.length, contributed.length)
    return countRefusal !== null ? countRefusal : checkRiskElements(contributed)
  }
  if (field === 'key_decisions') {
    const contributed = contribution.key_decisions
    if (contributed === undefined) {
      return null
    }
    return checkCollectionCount('key_decisions', stored.key_decisions.length, contributed.length)
  }
  const contributed = contribution.out_of_scope
  if (contributed === undefined) {
    return null
  }
  return checkCollectionCount('out_of_scope', stored.out_of_scope.length, contributed.length)
}

const nextStepCriterionRefusal = (criterionId: Ulid, reason: string): Refusal => ({
  ok: false,
  field: 'next_step_criterion_id',
  accepted: 'the id of a completion criterion on this thread that is neither done nor struck, sent together with next_step',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `next_step_criterion_id ${criterionId} ${reason}; remedy: send it together with next_step and name a criterion that is still open, or omit it.`
})

export const checkNextStepCriterion = (criteria: readonly Criterion[], contribution: SpineContribution): Refusal | null => {
  const criterionId = contribution.next_step_criterion_id
  if (criterionId === undefined) return null
  if (contribution.next_step === undefined) {
    return nextStepCriterionRefusal(criterionId, 'was sent without next_step, and it only names the criterion a next_step sent in the same call advances')
  }
  const criterion = criteria.find((candidate) => candidate.id === criterionId)
  if (criterion === undefined) return nextStepCriterionRefusal(criterionId, 'names no completion criterion on this thread')
  if (criterion.struck_by !== null) return nextStepCriterionRefusal(criterionId, 'names a criterion that has been struck')
  if (criterion.done) return nextStepCriterionRefusal(criterionId, 'names a criterion that is already done')
  return null
}

const nextStepAnchorField = (stored: Spine, contribution: SpineContribution): Pick<Spine, 'next_step_criterion_id'> => {
  const anchor = contribution.next_step === undefined ? stored.next_step_criterion_id : contribution.next_step_criterion_id
  return anchor === undefined ? {} : { next_step_criterion_id: anchor }
}

const escapeRisk = (risk: Risk): Risk => ({
  ...risk,
  scope: escapeStored(risk.scope),
  text: escapeStored(risk.text),
  refs: risk.refs.map((ref) => escapeStored(ref))
})

const escapeKeyDecision = (entry: KeyDecision): KeyDecision => ({
  ...entry,
  title: escapeStored(entry.title),
  scope: escapeStored(entry.scope)
})

const escapeOutOfScope = (entry: OutOfScope): OutOfScope => ({
  ...entry,
  text: escapeStored(entry.text)
})

const mergeSpine = (stored: Spine, contribution: SpineContribution): Spine => ({
  active_goal: contribution.active_goal !== undefined ? escapeStored(contribution.active_goal) : stored.active_goal,
  next_step: contribution.next_step !== undefined ? escapeStored(contribution.next_step) : stored.next_step,
  ...nextStepAnchorField(stored, contribution),
  landed: contribution.landed !== undefined ? escapeStored(contribution.landed) : stored.landed,
  last_session: contribution.last_session !== undefined ? escapeStored(contribution.last_session) : stored.last_session,
  open_risks:
    contribution.open_risks !== undefined
      ? [...stored.open_risks, ...contribution.open_risks.map(escapeRisk)]
      : stored.open_risks,
  key_decisions:
    contribution.key_decisions !== undefined
      ? [...stored.key_decisions, ...contribution.key_decisions.map(escapeKeyDecision)]
      : stored.key_decisions,
  out_of_scope:
    contribution.out_of_scope !== undefined
      ? [...stored.out_of_scope, ...contribution.out_of_scope.map(escapeOutOfScope)]
      : stored.out_of_scope
})

export const contributeToSpine = (stored: Spine, contribution: SpineContribution): Ok<Spine> | Refusal => {
  for (const field of COLLECTION_FIELDS) {
    const refusal = checkCollectionField(field, stored, contribution)
    if (refusal !== null) {
      return refusal
    }
  }
  return { ok: true, value: mergeSpine(stored, contribution) }
}
