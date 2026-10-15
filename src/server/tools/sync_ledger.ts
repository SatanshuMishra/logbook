import { z } from 'zod'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { findRepository, startDirectory, type RepoPaths } from '../../thread/paths.ts'
import { syncThreads, type SyncResult } from '../../thread/sync.ts'
import { NO_ARGUMENTS } from '../no-arguments.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'sync_ledger'
const NO_ORIGIN = 'no-origin'

const SyncLedgerInputSchema = NO_ARGUMENTS

const SyncLedgerOutputSchema = z.object({
  fetched: z.boolean().describe("whether origin's threads were fetched"),
  merged: z
    .boolean()
    .describe("whether origin's threads were brought in, by moving the local threads forward or by a merge commit"),
  conflicts: z
    .array(z.string())
    .describe(
      "the slugs of the threads whose stored document or working copy now holds git's conflict markers, to be resolved by editing the working copy; empty when none"
    ),
  pushed: z.boolean().describe('whether the local threads were pushed to origin'),
  error: z
    .string()
    .nullable()
    .describe('no-origin when the repository has no remote named origin, what failed when a fetch or push failed, or null')
})

type SyncLedgerInput = z.infer<typeof SyncLedgerInputSchema>
type SyncLedgerOutput = z.infer<typeof SyncLedgerOutputSchema>

const noWorkingDirectory = (): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a readable working directory inside a git repository, or CLAUDE_PROJECT_DIR naming one',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: 'logbook could not read its working directory and CLAUDE_PROJECT_DIR is not set, so it cannot find the repository'
})

const locate = (rt: Runtime): Ok<RepoPaths> | Refusal => {
  const dir = startDirectory(rt, rt.cwd ?? '')
  return dir === '' ? noWorkingDirectory() : findRepository(rt, dir)
}

const summaryOf = (result: SyncResult): string => {
  if (result.error === NO_ORIGIN) return 'sync: this repository has no remote named origin, so there is nothing to sync with.'
  const parts = [
    ...(result.merged ? ["brought in origin's threads"] : []),
    ...(result.conflicts.length > 0
      ? [`left conflict markers in ${result.conflicts.join(', ')}; resolve them by editing each working copy`]
      : []),
    ...(result.pushed ? ['pushed the threads to origin'] : []),
    ...(result.error === null ? [] : [`stopped: ${result.error}`])
  ]
  return parts.length === 0 ? 'sync: the threads already agree with origin.' : `sync: ${parts.join('; ')}.`
}

export const syncLedgerTool: ToolSpec<SyncLedgerInput, SyncLedgerOutput> = {
  name: TOOL_NAME,
  title: 'Sync ledger',
  description:
    "Brings this repository's threads and origin's into agreement. Takes no arguments. It fetches origin's threads, moves the local threads forward when they are behind, pushes them when they are ahead, and when both sides changed it merges each thread's state document line by line and pushes the merge. A thread changed on the same line on both sides keeps git's conflict markers and is named in conflicts, to be resolved by editing its working copy. Replies with what happened; a repository with no remote named origin replies with the error no-origin.",
  input: SyncLedgerInputSchema,
  output: SyncLedgerOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const result = await syncThreads(rt, paths.value)
    return {
      ok: true,
      text: summaryOf(result),
      structured: {
        fetched: result.fetched,
        merged: result.merged,
        conflicts: result.conflicts,
        pushed: result.pushed,
        error: result.error
      }
    }
  }
}
