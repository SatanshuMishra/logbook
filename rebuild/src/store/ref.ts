import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { git } from './git.ts'

export const LEDGER_REF = 'refs/logbook/ledger'

export const casUpdateRef = (
  rt: Runtime,
  repo: string,
  ref: string,
  next: string,
  expected: string | null
): Ok<void> | Refusal => {
  const expectedArg = expected === null ? '' : expected
  const result = git(rt, repo, ['update-ref', ref, next, expectedArg])
  if (result.ok) {
    return { ok: true, value: undefined }
  }
  return {
    ok: false,
    field: 'ref-moved',
    accepted: `the current value of ${ref} equal to ${expected === null ? '(no prior value)' : expected} at the moment of the write`,
    example: next,
    retryable: true,
    message: `${ref} moved before this write landed (git update-ref exit ${result.code}: ${result.stderr.trim()}); re-read and retry`
  }
}
