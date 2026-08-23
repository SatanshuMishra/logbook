import type { Runtime } from '../runtime/runtime.ts'
import type { Thread, Criterion } from '../schema/thread.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { evaluateDoneGate, type GateFailure } from './done-gate.ts'

const renderOutstanding = (outstanding: readonly Criterion[]): string =>
  outstanding.map((criterion) => `${criterion.id}: ${criterion.text}`).join('; ')

const refuseAbandon = (): Refusal => ({
  ok: false,
  field: 'detail',
  accepted: 'a non-empty abandon reason',
  example: 'superseded by a later thread',
  retryable: true,
  message: 'abandoning a thread requires a non-empty reason.'
})

const refuseGate = (failure: GateFailure): Refusal => {
  if (failure.reason === 'no-criteria') {
    return {
      ok: false,
      field: 'completion_criteria',
      accepted: 'at least one un-struck completion criterion',
      example: 'add a completion criterion, or unstrike one, before closing as done',
      retryable: true,
      message: 'closing as done requires at least one un-struck completion criterion; none remain on this thread.'
    }
  }
  if (failure.reason === 'criteria-open') {
    return {
      ok: false,
      field: 'completion_criteria',
      accepted: 'every un-struck completion criterion marked done',
      example: 'mark each outstanding criterion done, or strike it, then retry',
      retryable: true,
      message: `closing as done requires every un-struck completion criterion to be marked done; outstanding: ${renderOutstanding(failure.outstanding)}.`
    }
  }
  return {
    ok: false,
    field: 'closure',
    accepted: 'a non-empty closure statement',
    example: 'shipped the done gate and its tests',
    retryable: true,
    message: 'closing as done requires a non-empty closure statement.'
  }
}

export const transition = (rt: Runtime, thread: Thread, to: 'done' | 'abandoned', detail: string): Ok<Thread> | Refusal => {
  if (to === 'abandoned') {
    if (detail.trim().length === 0) {
      return refuseAbandon()
    }
    return { ok: true, value: { ...thread, status: 'abandoned', updated_at: rt.now() } }
  }

  const gate = evaluateDoneGate(thread, detail)
  if ('reason' in gate) {
    return refuseGate(gate)
  }
  return { ok: true, value: { ...thread, status: 'done', updated_at: rt.now() } }
}
