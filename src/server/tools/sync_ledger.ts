import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { NO_ARGUMENTS } from '../no-arguments.ts'
import type { Refusal } from '../../schema/declare.ts'
import { layoutFor } from '../../store/layout.ts'
import { sync } from '../../merge/sync.ts'
import { withDetail } from '../../store/detail.ts'
import { escapeStored } from '../../render/escape.ts'
import { clipWithMarker } from '../../render/clip.ts'
import * as caps from '../../schema/caps.ts'
import { openProjectStore } from '../tool-support.ts'

const SyncLedgerInputSchema = NO_ARGUMENTS

const SyncLedgerOutputSchema = z.object({
  action: z
    .enum(['noop', 'pushed', 'pushed-unverified', 'fast-forwarded', 'merged'])
    .describe('what sync did: nothing changed, a push whose arrival on the shared copy was confirmed, a push whose arrival could not be confirmed, a fast-forward of the local ledger, or a real merge of both sides'),
  ref: z.string().describe('the ledger ref that sync acted on'),
  local_sha: z
    .string()
    .nullable()
    .describe('the commit this machine holds on the ledger ref when sync finished, or null when it could not be read'),
  remote_sha: z
    .string()
    .nullable()
    .describe('the commit the shared copy holds on the ledger ref, read back from the remote after any push, or null when it could not be read')
})

type SyncLedgerInput = z.infer<typeof SyncLedgerInputSchema>
type SyncLedgerOutput = z.infer<typeof SyncLedgerOutputSchema>

export const offlineRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'sync',
      accepted: 'a reachable git remote named origin',
      example: 'check network access and that `git remote -v` lists origin',
      retryable: true,
      message: 'the shared ledger could not be reached: origin did not respond; check network access and that `git remote -v` lists a reachable origin.'
    },
    detail
  )

export const rejectedRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'sync',
      accepted: 'a push the remote will accept without further changes',
      example: 'retry the call',
      retryable: true,
      message: 'the push to the shared ledger to origin was rejected; retry the call.'
    },
    detail
  )

export const unparseableRecordsRefusal = (records: readonly string[]): Refusal => {
  const escaped = records.map((record) => clipWithMarker(escapeStored(record), caps.UNPARSEABLE_RECORD_NAME_MAX))
  const shown = escaped.slice(0, caps.UNPARSEABLE_RECORDS_SHOWN_MAX)
  const remainder = escaped.length - shown.length
  const named = remainder > 0 ? `${shown.join(', ')} (+${remainder} more)` : shown.join(', ')
  return {
    ok: false,
    field: 'sync',
    accepted: 'a shared ledger whose every record file this version can read',
    example: 'upgrade this plugin to the version that wrote those records, or have the teammate who wrote them repair or remove them on the shared copy',
    retryable: false,
    message: `sync stopped before merging: the shared ledger carries ${escaped.length} record file(s) this version cannot read: ${named}. Nothing was merged and nothing was sent to origin. Repeating this call cannot help, because the bytes live on the shared copy: upgrade this plugin to the version that wrote those records, or have the teammate who wrote them repair or remove them, then run sync_ledger again.`
  }
}

export const conflictRefusal = (conflicts: readonly { record: string; field: string }[]): Refusal => {
  const named = conflicts.map((c) => `${c.record} ${c.field}`).join('; ')
  return {
    ok: false,
    field: 'sync',
    accepted: 'no field that both sides changed to different values',
    example: 'call resolve_conflict naming a winner for each disagreement this reports',
    retryable: true,
    message: `sync found disagreements on: ${named}. Nothing was pushed; call resolve_conflict to settle each one, then retry sync_ledger.`
  }
}

export const syncLedgerTool: ToolSpec<SyncLedgerInput, SyncLedgerOutput> = {
  name: 'sync_ledger',
  title: 'Sync ledger',
  description:
    "Brings this machine's ledger and the shared one into agreement: it fetches, works out which side is ahead, merges record by record when both moved, and pushes. Takes no arguments. When two people changed the same single-value field to different things it refuses instead of choosing, keeps both versions readable, pushes nothing, and reports what disagreed so resolve_conflict can settle it. Running it when nothing changed is cheap and reports that nothing changed, which is different from reporting that it could not reach the shared copy.",
  input: SyncLedgerInputSchema,
  output: SyncLedgerOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const outcome = sync(rt, store, layout.value)

    if (outcome.ok) {
      return {
        ok: true,
        text: `sync ${outcome.action === 'noop' ? 'found nothing to do' : outcome.action}.`,
        structured: {
          action: outcome.action,
          ref: outcome.ref,
          local_sha: outcome.local_sha,
          remote_sha: outcome.remote_sha
        }
      }
    }

    if (outcome.reason === 'conflict') {
      return { ok: false, refusal: conflictRefusal(outcome.conflicts) }
    }
    if (outcome.reason === 'unparseable') {
      return { ok: false, refusal: unparseableRecordsRefusal(outcome.records) }
    }
    if (outcome.reason === 'offline') {
      return { ok: false, refusal: offlineRefusal(outcome.detail) }
    }
    return { ok: false, refusal: rejectedRefusal(outcome.detail) }
  }
}
