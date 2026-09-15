import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { NO_ARGUMENTS } from '../no-arguments.ts'
import type { Refusal } from '../../schema/declare.ts'
import { layoutFor } from '../../store/layout.ts'
import { sync, type RejectedOutcome } from '../../merge/sync.ts'
import type { ConflictReportEntry } from '../../merge/conflict.ts'
import { GIT_MERGE_TREE_FLOOR } from '../../merge/merge-tree.ts'
import { withDetail } from '../../store/detail.ts'
import { escapeStored } from '../../render/escape.ts'
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

const remoteRejectedRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'sync',
      accepted: "a shared ledger that accepts this machine's push",
      example: 'resolve the objection origin reported and run sync_ledger again',
      retryable: false,
      message:
        'origin refused the push; nothing was merged into the shared copy, and repeating this call cannot change that on its own.'
    },
    detail
  )

const contentionRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'sync',
      accepted: 'a ledger ref that is not being moved by another sync at the same time',
      example: 'retry the call',
      retryable: true,
      message:
        'the ledger ref kept moving while sync worked; nothing was pushed. A retry can succeed once the other writer stops.'
    },
    detail
  )

const localSyncFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'sync',
      accepted: 'a local ledger write that this machine can complete',
      example: 'retry the call once the condition named below is cleared',
      retryable: true,
      message: "this machine's own ledger could not be updated; nothing was sent to origin."
    },
    detail
  )

export const rejectedRefusal = (outcome: RejectedOutcome): Refusal => {
  if (outcome.cause === 'remote-rejected') return remoteRejectedRefusal(outcome.detail)
  if (outcome.cause === 'contention') return contentionRefusal(outcome.detail)
  return localSyncFailureRefusal(outcome.detail)
}

export const gitTooOldRefusal = (found: string): Refusal => ({
  ok: false,
  field: 'sync',
  accepted: `git ${GIT_MERGE_TREE_FLOOR} or later, which can merge two ledgers without a working tree`,
  example: `upgrade git to ${GIT_MERGE_TREE_FLOOR} or later, then run sync_ledger again`,
  retryable: false,
  message: `this machine's git is ${escapeStored(found)}, and merging this ledger with the shared copy needs git ${GIT_MERGE_TREE_FLOOR} or later; nothing was merged and nothing was pushed. Pushing and fast-forwarding still work on this version, so sync succeeds whenever only one side has moved.`
})

const CONFLICT_ADDRESS_PREFIX = 'logbook://conflict/'

const versionLine = (label: string, blob: string | null, absent: string): string =>
  `${label}: ${blob === null ? absent : `${CONFLICT_ADDRESS_PREFIX}${blob}`}`

const changesText = (changes: readonly string[] | null): string => {
  if (changes === null) return 'could not be listed, a version is not valid JSON'
  if (changes.length === 0) return 'nothing'
  return changes.map((change) => escapeStored(change)).join(', ')
}

const renderConflictEntry = (entry: ConflictReportEntry): string =>
  [
    `<${escapeStored(entry.path, 'angle-wrapped')}>`,
    versionLine('ancestor', entry.base_blob, 'none, the two ledgers share no history'),
    versionLine('local', entry.local_blob, 'deleted on this machine'),
    versionLine('remote', entry.remote_blob, 'deleted on the shared copy'),
    ...(entry.base_blob === null
      ? [`differs between the two: ${changesText(entry.local_changes)}`]
      : [`changed locally: ${changesText(entry.local_changes)}`, `changed remotely: ${changesText(entry.remote_changes)}`])
  ].join('\n')

const REVIEW_GUIDANCE =
  "Review before resolving. Read each file's ancestor, local and remote versions whole, and read the thread's decisions and session entries on both sides where they explain a change. Compose each record as it should now read, keeping every change from both sides that still belongs. When both versions are valid alternatives rather than one being out of date, bring them to the user with a recommended resolution and wait for their choice or their own. Do not take one side whole without having reviewed the other. Then call resolve_conflict once with every file listed above, and run sync_ledger again."

export const conflictRefusal = (entries: readonly ConflictReportEntry[]): Refusal => ({
  ok: false,
  field: 'sync',
  accepted: 'a merge in which no file was changed differently on both sides',
  example: 'review each conflicted file, then call resolve_conflict with each record as it should now read',
  retryable: true,
  message: [
    `sync found ${entries.length} file(s) changed differently on this machine and on the shared copy since they last agreed. Nothing was merged and nothing was pushed.`,
    ...entries.map(renderConflictEntry),
    REVIEW_GUIDANCE
  ].join('\n\n')
})

export const syncLedgerTool: ToolSpec<SyncLedgerInput, SyncLedgerOutput> = {
  name: 'sync_ledger',
  title: 'Sync ledger',
  description:
    "Brings this machine's ledger and the shared one into agreement: it fetches, works out which side is ahead, has git merge the two when both moved, and pushes. Takes no arguments. When both sides changed the same record file, it refuses instead of choosing, pushes nothing, and reports each such file with where to read its ancestor, local and remote versions, so they can be reviewed and settled with resolve_conflict. Running it when nothing changed is cheap and reports that nothing changed, which is different from reporting that it could not reach the shared copy.",
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
      return { ok: false, refusal: conflictRefusal(outcome.entries) }
    }
    if (outcome.reason === 'git-too-old') {
      return { ok: false, refusal: gitTooOldRefusal(outcome.found) }
    }
    if (outcome.reason === 'offline') {
      return { ok: false, refusal: offlineRefusal(outcome.detail) }
    }
    return { ok: false, refusal: rejectedRefusal(outcome) }
  }
}
