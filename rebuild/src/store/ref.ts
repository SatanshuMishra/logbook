import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { withDetail } from './detail.ts'
import { git } from './git.ts'

export const LEDGER_REF = 'refs/logbook/ledger'

export type CasFailure = Refusal & { cause: 'ref-moved' | 'io' }

const CAS_MISMATCH_PATTERN = /cannot lock ref '[^']*': (is at [0-9a-f]+ but expected|reference already exists)/

const classifyFailure = (stderr: string): 'ref-moved' | 'io' =>
  CAS_MISMATCH_PATTERN.test(stderr) ? 'ref-moved' : 'io'

export const casUpdateRef = (
  rt: Runtime,
  repo: string,
  ref: string,
  next: string,
  expected: string | null
): Ok<void> | CasFailure => {
  const expectedArg = expected === null ? '' : expected
  const result = git(rt, repo, ['update-ref', ref, next, expectedArg])
  if (result.ok) {
    return { ok: true, value: undefined }
  }

  const cause = classifyFailure(result.stderr)
  const detail = result.stderr.trim()

  if (cause === 'ref-moved') {
    rt.log({ level: 'error', event: 'store.cas-update-ref-moved', ref, code: result.code, detail })
    return withDetail(
      {
        ok: false,
        cause,
        field: ref,
        accepted: `the current value of ${ref} equal to ${expected === null ? '(no prior value)' : expected} at the moment of the write`,
        example: next,
        retryable: true,
        message: `${ref} moved before this write landed (git update-ref exit ${result.code}); re-read and retry`
      },
      detail
    )
  }

  rt.log({ level: 'error', event: 'store.cas-update-ref-failed', ref, code: result.code, detail })
  return withDetail(
    {
      ok: false,
      cause,
      field: ref,
      accepted: 'a repository git update-ref can execute against, unmoved',
      example: next,
      retryable: false,
      message: `git update-ref failed for ${ref} (exit ${result.code})`
    },
    detail
  )
}
