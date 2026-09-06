import type { Ok, Refusal } from '../schema/declare.ts'
import type { KeyDecision, OutOfScope, Risk, Spine } from '../schema/thread.ts'
import * as caps from '../schema/caps.ts'
import { escapeStored } from '../render/escape.ts'

export type SpineContribution = {
  active_goal?: string
  next_step?: string
  last_session?: string
  open_risks?: Risk[]
  key_decisions?: KeyDecision[]
  out_of_scope?: OutOfScope[]
}

type ScalarField = 'active_goal' | 'next_step' | 'last_session'
type CollectionField = 'open_risks' | 'key_decisions' | 'out_of_scope'

const SCALAR_FIELDS: ScalarField[] = ['active_goal', 'next_step', 'last_session']
const COLLECTION_FIELDS: CollectionField[] = ['open_risks', 'key_decisions', 'out_of_scope']

const SCALAR_CAP: Record<ScalarField, number> = {
  active_goal: caps.SPINE_ACTIVE_GOAL_MAX,
  next_step: caps.SPINE_NEXT_STEP_MAX,
  last_session: caps.SPINE_LAST_SESSION_MAX
}

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

const capRefusal = (field: string, limit: number, observed: number, unit: string, remedy: string): Refusal => ({
  ok: false,
  field,
  accepted: `at most ${limit} ${unit}`,
  example: `a ${field} contribution within ${limit} ${unit}`,
  retryable: true,
  message: `${field} exceeds its cap of ${limit} ${unit}; observed ${observed} ${unit} for this call; remedy: ${remedy}.`
})

const checkTextCap = (field: string, value: string, limit: number, remedy: string): Refusal | null => {
  const observed = escapeStored(value).length
  if (observed > limit) {
    return capRefusal(field, limit, observed, 'characters', remedy)
  }
  return null
}

const checkScalarField = (field: ScalarField, value: string | undefined): Refusal | null => {
  if (value === undefined) {
    return null
  }
  return checkTextCap(field, value, SCALAR_CAP[field], 'shorten the value and retry')
}

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
    const textRefusal = checkTextCap(
      `risks_add[${index}].text`,
      risk.text,
      caps.RISK_TEXT_MAX,
      'shorten the risk text and retry'
    )
    if (textRefusal !== null) {
      return textRefusal
    }
    const scopeRefusal = checkTextCap(
      `risks_add[${index}].scope`,
      risk.scope,
      caps.RISK_SCOPE_MAX,
      'shorten the scope and retry'
    )
    if (scopeRefusal !== null) {
      return scopeRefusal
    }
    if (risk.refs.length > caps.RISK_REFS_MAX_ELEMENTS) {
      return capRefusal(
        `risks_add[${index}].refs`,
        caps.RISK_REFS_MAX_ELEMENTS,
        risk.refs.length,
        'entries',
        'remove refs and retry'
      )
    }
    for (const [refIndex, ref] of risk.refs.entries()) {
      const refRefusal = checkTextCap(
        `risks_add[${index}].refs[${refIndex}]`,
        ref,
        caps.RISK_REF_MAX,
        'shorten the ref and retry'
      )
      if (refRefusal !== null) {
        return refRefusal
      }
    }
  }
  return null
}

const checkKeyDecisionElements = (contributed: KeyDecision[]): Refusal | null => {
  for (const [index, entry] of contributed.entries()) {
    const refusal = checkTextCap(
      `key_decisions_add[${index}].title`,
      entry.title,
      caps.KEY_DECISION_TITLE_MAX,
      'shorten the title and retry'
    )
    if (refusal !== null) {
      return refusal
    }
    const scopeRefusal = checkTextCap(
      `key_decisions_add[${index}].scope`,
      entry.scope,
      caps.KEY_DECISION_SCOPE_MAX,
      'shorten the scope and retry'
    )
    if (scopeRefusal !== null) {
      return scopeRefusal
    }
  }
  return null
}

const checkOutOfScopeElements = (contributed: OutOfScope[]): Refusal | null => {
  for (const [index, entry] of contributed.entries()) {
    const refusal = checkTextCap(
      `out_of_scope_add[${index}]`,
      entry.text,
      caps.OUT_OF_SCOPE_TEXT_MAX,
      'shorten the statement and retry'
    )
    if (refusal !== null) {
      return refusal
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
    const countRefusal = checkCollectionCount('key_decisions', stored.key_decisions.length, contributed.length)
    return countRefusal !== null ? countRefusal : checkKeyDecisionElements(contributed)
  }
  const contributed = contribution.out_of_scope
  if (contributed === undefined) {
    return null
  }
  const countRefusal = checkCollectionCount('out_of_scope', stored.out_of_scope.length, contributed.length)
  return countRefusal !== null ? countRefusal : checkOutOfScopeElements(contributed)
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
  landed: stored.landed,
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
  for (const field of SCALAR_FIELDS) {
    const refusal = checkScalarField(field, contribution[field])
    if (refusal !== null) {
      return refusal
    }
  }
  for (const field of COLLECTION_FIELDS) {
    const refusal = checkCollectionField(field, stored, contribution)
    if (refusal !== null) {
      return refusal
    }
  }
  return { ok: true, value: mergeSpine(stored, contribution) }
}
