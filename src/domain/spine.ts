import type { Ok, Refusal } from '../schema/declare.ts'
import type { KeyDecision, OutOfScope, Risk, Spine, Ulid } from '../schema/thread.ts'
import type { Store } from '../store/records.ts'
import * as caps from '../schema/caps.ts'
import { escapeStored } from '../render/escape.ts'
import { renderRecordsInFull } from '../render/briefing.ts'
import { indexRecords, matchByFileName, resolveRecordIds, type IndexedRecord } from './record-index.ts'

export type SpineContribution = {
  active_goal?: string
  next_step?: string
  next_step_records?: Ulid[]
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

export const NEXT_STEP_RECORDS_DESCRIPTION =
  'the ids of every record the next_step needs: decisions, risks, criteria, session entries, artifacts or out-of-scope notes, from this thread or any other, closed threads included. Required whenever next_step is sent. Find them with search_ledger before setting the step, and send [] only when the step needs none. The reply returns each named record in full, plus any live decision or risk whose text names a file the step names.'

export const NEXT_STEP_RECORD_ID_DESCRIPTION = 'the id of one record the next_step needs'

export const STEP_RECORDS_OUTPUT_DESCRIPTION =
  'when next_step was set: the records the step names, in full, and any record matched by file name'

const STEP_RECORDS_EXAMPLE = '["01ARZ3NDEKTSV4RRFFQ69G5FAV"]'

const recordsWithoutStepRefusal = (): Refusal => ({
  ok: false,
  field: 'next_step_records',
  accepted: 'next_step_records together with next_step in the same call',
  example: STEP_RECORDS_EXAMPLE,
  retryable: true,
  message:
    'next_step_records was sent without next_step. The list is stored with the step it serves; send next_step in the same call, or leave next_step_records out.'
})

const stepWithoutRecordsRefusal = (): Refusal => ({
  ok: false,
  field: 'next_step_records',
  accepted: 'a list of record ids sent together with next_step, or [] when the step needs no record',
  example: STEP_RECORDS_EXAMPLE,
  retryable: true,
  message:
    'next_step was sent without next_step_records. List the records this step needs, found with search_ledger (decisions, risks, criteria and session entries on any thread, closed ones included), or send [] if it needs none.'
})

const unknownStepRecordsRefusal = (missing: readonly string[]): Refusal => ({
  ok: false,
  field: 'next_step_records',
  accepted: 'ids of records stored in this project',
  example: STEP_RECORDS_EXAMPLE,
  retryable: true,
  message: `next_step_records names ids that match no stored record: ${missing.join(', ')}. search_ledger lists the stored records, on every thread, closed ones included.`
})

type SentStep = { next_step?: string | undefined; next_step_records?: readonly string[] | undefined }

const pairingRefusal = (sent: SentStep): Refusal | null => {
  if (sent.next_step === undefined) return sent.next_step_records === undefined ? null : recordsWithoutStepRefusal()
  return sent.next_step_records === undefined ? stepWithoutRecordsRefusal() : null
}

export type StepRecords = { index: readonly IndexedRecord[]; named: readonly IndexedRecord[] }

export const resolveStepRecords = (store: Store, ids: readonly string[]): Ok<StepRecords> | Refusal => {
  const index = indexRecords(store)
  const { found, missing } = resolveRecordIds(index, ids)
  return missing.length > 0 ? unknownStepRecordsRefusal(missing) : { ok: true, value: { index, named: found } }
}

export const checkStepRecords = (store: Store, sent: SentStep): Ok<StepRecords | null> | Refusal => {
  const refused = pairingRefusal(sent)
  if (refused !== null) return refused
  return sent.next_step_records === undefined ? { ok: true, value: null } : resolveStepRecords(store, sent.next_step_records)
}

export const renderStepRecords = (records: StepRecords, storedNextStep: string): string =>
  renderRecordsInFull(
    records.named,
    matchByFileName(records.index, storedNextStep, new Set(records.named.map((record) => record.id)))
  )

const nextStepAnchorField = (stored: Spine, contribution: SpineContribution): Pick<Spine, 'next_step_criterion_id'> =>
  contribution.next_step !== undefined || stored.next_step_criterion_id === undefined
    ? {}
    : { next_step_criterion_id: stored.next_step_criterion_id }

const nextStepRecordsField = (stored: Spine, contribution: SpineContribution): Pick<Spine, 'next_step_records'> => {
  const records =
    contribution.next_step === undefined ? stored.next_step_records : [...(contribution.next_step_records ?? [])]
  return records === undefined ? {} : { next_step_records: records }
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
  ...nextStepRecordsField(stored, contribution),
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
  for (const field of COLLECTION_FIELDS) {
    const refusal = checkCollectionField(field, stored, contribution)
    if (refusal !== null) {
      return refusal
    }
  }
  return { ok: true, value: mergeSpine(stored, contribution) }
}
