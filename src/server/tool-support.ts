import type { Runtime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { ThreadRecord, type Thread, type Ulid } from '../schema/thread.ts'
import * as caps from '../schema/caps.ts'
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

export const loadThreadForReference = (store: Store, field: string, id: Ulid): Attempt<Thread> => {
  const slot = store.readThread(id)
  if (slot === null) return { ok: false, refusal: threadNotFoundRefusal(field, id) }
  if (slot.quarantined) return { ok: false, refusal: threadQuarantinedRefusal(field, id) }
  return { ok: true, value: slot.record }
}

export const resolvePredecessor = (rt: Runtime, store: Store, thread: Thread): Thread | null => {
  const predecessorId = thread.predecessor_id
  if (predecessorId === undefined) return null
  const slot = store.readThread(predecessorId)
  if (slot === null) {
    rt.log({ level: 'error', event: 'briefing.predecessor-dangling', thread_id: thread.id, predecessor_id: predecessorId })
    return null
  }
  if (slot.quarantined) {
    rt.log({ level: 'error', event: 'briefing.predecessor-quarantined', thread_id: thread.id, predecessor_id: predecessorId })
    return null
  }
  return slot.record
}

export const loadThread = (store: Store, field: string, id: Ulid): Attempt<Thread> => {
  const slot = store.readThread(id)
  if (slot === null) return { ok: false, refusal: threadNotFoundRefusal(field, id) }
  if (slot.quarantined) return { ok: false, refusal: threadQuarantinedRefusal(field, id) }
  if (slot.record.status !== 'open') return { ok: false, refusal: threadClosedRefusal(field, id, slot.record.status) }
  return { ok: true, value: slot.record }
}

const byteSizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')

const heaviestFieldOf = (thread: Thread): { field: string; bytes: number } => {
  const measured = Object.entries(thread as unknown as Record<string, unknown>).flatMap(([key, value]) => {
    if (key !== 'spine' || typeof value !== 'object' || value === null) {
      return [{ field: key, bytes: byteSizeOf(value) }]
    }
    return Object.entries(value as Record<string, unknown>).map(([spineKey, spineValue]) => ({
      field: `spine.${spineKey}`,
      bytes: byteSizeOf(spineValue)
    }))
  })
  return measured.reduce(
    (worst, candidate) => (candidate.bytes > worst.bytes ? candidate : worst),
    { field: 'spine', bytes: 0 }
  )
}

const overByteCapRefusal = (thread: Thread, observed: number): Refusal => {
  const heaviest = heaviestFieldOf(thread)
  return {
    ok: false,
    field: 'thread',
    accepted: `a serialised thread record of at most ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes`,
    example: 'remove an entry from the largest field and retry',
    retryable: true,
    message: `the thread record after this change is ${observed} bytes, over its cap of ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes; its largest field is ${heaviest.field} at ${heaviest.bytes} bytes; remedy: remove or shorten an entry in ${heaviest.field} and retry.`
  }
}

const invalidThreadRecordRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a thread record that matches its stored shape',
  example: 'shorten or remove the entry that failed validation and retry',
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
  const bytes = byteSizeOf(thread)
  if (bytes > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) {
    return { ok: false, refusal: overByteCapRefusal(thread, bytes) }
  }
  const validated = ThreadRecord.parse(thread)
  if (!validated.ok) {
    return { ok: false, refusal: invalidThreadRecordRefusal(validated.message) }
  }
  const result = store.commit([{ kind: 'thread', record: validated.value }], message)
  if (!result.ok) {
    return { ok: false, refusal: commitFailureRefusal(result.detail) }
  }
  return { ok: true, value: validated.value }
}
