import type { Runtime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { ThreadRecord, type Thread, type Ulid } from '../schema/thread.ts'
import { openStore, type Store } from '../store/records.ts'
import { withDetail } from '../store/detail.ts'

export type Attempt<T> = { ok: true; value: T } | { ok: false; refusal: Refusal }

export const openProjectStore = (rt: Runtime): Attempt<Store> => {
  const opened = openStore(rt, rt.cwd)
  return opened.ok ? { ok: true, value: opened.value } : { ok: false, refusal: opened }
}

const threadNotFoundRefusal = (field: string, id: string): Refusal => ({
  ok: false,
  field,
  accepted: 'the id of a thread already recorded in this project',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `${field} does not match any thread in this project; received ${id}.`
})

const threadQuarantinedRefusal = (field: string, id: string): Refusal => ({
  ok: false,
  field,
  accepted: 'the id of a thread whose stored record parses cleanly',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `${field} names a thread record that failed to parse and was quarantined; received ${id}.`
})

const threadClosedRefusal = (field: string, id: string, status: Thread['status']): Refusal => ({
  ok: false,
  field,
  accepted: 'the id of a thread that is still open',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `${field} names a thread that is already ${status}, which is terminal; open a new thread that references this one instead; received ${id}.`
})

export const loadThread = (store: Store, field: string, id: Ulid): Attempt<Thread> => {
  const slot = store.readThread(id)
  if (slot === null) return { ok: false, refusal: threadNotFoundRefusal(field, id) }
  if (slot.quarantined) return { ok: false, refusal: threadQuarantinedRefusal(field, id) }
  if (slot.record.status !== 'open') return { ok: false, refusal: threadClosedRefusal(field, id, slot.record.status) }
  return { ok: true, value: slot.record }
}

const wholeRecordCapRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a serialised thread record that stays within the whole-record byte cap',
  example: 'split the contribution across multiple calls, or retire an existing entry before retrying',
  retryable: true,
  message: `the thread record after this change failed its stored-shape validation: ${issue}`
})

const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'thread',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for this thread did not complete; retry the call.'
    },
    detail
  )

export const commitThread = (store: Store, thread: Thread, message: string): Attempt<Thread> => {
  const validated = ThreadRecord.parse(thread)
  if (!validated.ok) {
    return { ok: false, refusal: wholeRecordCapRefusal(validated.message) }
  }
  const result = store.commit([{ kind: 'thread', record: validated.value }], message)
  if (!result.ok) {
    return { ok: false, refusal: commitFailureRefusal(result.detail) }
  }
  return { ok: true, value: validated.value }
}
