import type { Thread, Criterion } from '../schema/thread.ts'
import type { Ok } from '../schema/declare.ts'

export type GateFailure = { outstanding: Criterion[]; reason: 'no-criteria' | 'criteria-open' | 'no-closure' }

export const evaluateDoneGate = (thread: Thread, closure: string): Ok<void> | GateFailure => {
  const unstruck = thread.completion_criteria.filter((criterion) => criterion.struck_by === null)
  if (unstruck.length === 0) {
    return { outstanding: [], reason: 'no-criteria' }
  }
  const outstanding = unstruck.filter((criterion) => !criterion.done)
  if (outstanding.length > 0) {
    return { outstanding, reason: 'criteria-open' }
  }
  if (closure.trim().length === 0) {
    return { outstanding: [], reason: 'no-closure' }
  }
  return { ok: true, value: undefined }
}
