import { existsSync, rmSync } from 'node:fs'
import { z } from 'zod'
import { formatViolation, type Violation } from '../../doc/check.ts'
import { parseDocument } from '../../doc/document.ts'
import { tidyRequest } from '../../doc/rules.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { git } from '../../store/git.ts'
import { activityLine, buildActivity } from '../../thread/activity.ts'
import { actingSession, readHold, takeHold, type Hold } from '../../thread/holds.ts'
import { listMarkers } from '../../thread/inflight.ts'
import { migrateIfNeeded } from '../../thread/migrate.ts'
import { convertedPath, findRepository, startDirectory, workingCopyPath, type RepoPaths } from '../../thread/paths.ts'
import { reconcileThread } from '../../thread/reconcile.ts'
import { readDocument, resolveThreadId } from '../../thread/store.ts'
import { syncThreads } from '../../thread/sync.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'resume_thread'
const ACTIVITY_HEADING = 'Activity since the last update:'
const RUNNING_HEADING = 'Was running when the session ended:'
const REFUSED_HEADING = 'The working copy has edits logbook refused:'
const SYNC_FAILED_PREFIX = 'Sync with origin failed: '
const CONFLICT_LINE =
  'Conflicts from the last sync are marked in the document; resolve them by editing the working copy.'

const ResumeThreadInputSchema = z
  .strictObject({
    thread_id: z
      .string()
      .describe(
        "the thread's slug, such as fix-login, or an old thread id listed in aliases.json; call list_threads to see each slug"
      ),
    full_briefing: z
      .boolean()
      .optional()
      .describe('accepted for callers that send it and ignored: every resume returns the whole document')
  })
  .describe('the thread to resume, named by its slug or an old thread id')

const ResumeThreadOutputSchema = z.object({
  thread_id: z.string().describe('the slug of the thread that was resumed'),
  briefing: z.string().describe("the thread's stored state document, now in context; do not print it"),
  path: z.string().describe("the working copy of the thread's state document, the file to edit with the Edit tool"),
  recovery: z
    .array(z.string())
    .describe(
      'lines about what happened since the last accepted update: earlier activity, tools that were still running, refused edits of the working copy, a failed sync, conflicts and a request to tidy a converted document; empty when there is nothing to report'
    )
})

type ResumeThreadInput = z.infer<typeof ResumeThreadInputSchema>
type ResumeThreadOutput = z.infer<typeof ResumeThreadOutputSchema>

type Recovery = {
  hold: Hold | null
  session: string
  violations: readonly Violation[]
  syncError: string | null
  documentText: string
  converted: boolean
}

const noWorkingDirectory = (): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a readable working directory inside a git repository, or CLAUDE_PROJECT_DIR naming one',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: 'logbook could not read its working directory and CLAUDE_PROJECT_DIR is not set, so it cannot find the repository'
})

const unknownThread = (threadId: string): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'the slug of a thread, or an old thread id listed in aliases.json',
  example: 'fix-login',
  retryable: true,
  message: `no thread is named ${JSON.stringify(threadId)}; call list_threads to see each thread's slug`
})

const locate = (rt: Runtime): Ok<RepoPaths> | Refusal => {
  const dir = startDirectory(rt, rt.cwd ?? '')
  return dir === '' ? noWorkingDirectory() : findRepository(rt, dir)
}

const hasOrigin = (rt: Runtime, paths: RepoPaths): boolean => {
  const origin = git(rt, paths.root, ['config', '--get', 'remote.origin.url'])
  return origin.ok && origin.stdout.trim() !== ''
}

const syncError = async (rt: Runtime, paths: RepoPaths): Promise<string | null> =>
  hasOrigin(rt, paths) ? (await syncThreads(rt, paths)).error : null

const group = (heading: string, lines: readonly string[]): string[] => (lines.length === 0 ? [] : [heading, ...lines])

const activityLines = (hold: Hold | null, file: string): string[] =>
  hold === null
    ? []
    : buildActivity({ transcripts: hold.transcripts, since: hold.folded_at, workingCopyPath: file }).lines

const runningLines = (paths: RepoPaths, slug: string, session: string): string[] =>
  listMarkers(paths, slug)
    .filter((marker) => marker.session !== session)
    .map((marker) => activityLine(marker.tool, marker.summary))

const recoveryLines = (paths: RepoPaths, slug: string, file: string, recovery: Recovery): string[] => [
  ...group(ACTIVITY_HEADING, activityLines(recovery.hold, file)),
  ...group(RUNNING_HEADING, runningLines(paths, slug, recovery.session)),
  ...group(REFUSED_HEADING, recovery.violations.map(formatViolation)),
  ...(recovery.syncError === null ? [] : [`${SYNC_FAILED_PREFIX}${recovery.syncError}`]),
  ...(parseDocument(recovery.documentText).conflictLines.length > 0 ? [CONFLICT_LINE] : []),
  ...(recovery.converted ? tidyRequest({ path: file, documentText: recovery.documentText }).split('\n') : [])
]

const replyText = (slug: string, file: string, documentText: string, recovery: readonly string[]): string =>
  [
    `Resumed thread ${slug}. Working copy: ${file}. The document below is now in your context; do not print it.`,
    '',
    documentText.replace(/\n+$/, ''),
    ...(recovery.length === 0 ? [] : ['', ...recovery])
  ].join('\n')

export const resumeThreadTool: ToolSpec<ResumeThreadInput, ResumeThreadOutput> = {
  name: TOOL_NAME,
  title: 'Resume thread',
  description:
    "Picks up a thread and makes this session its holder. It brings in the thread's changes from origin when the repository has one, commits a pending valid edit of the working copy, and returns the thread's state document, which is then in your context; do not print it. The reply names the working copy, the file to edit with the Edit tool whenever logbook asks for an update, and lists what happened since the last accepted update: the earlier session's activity, tools still running when it ended, edits of the working copy logbook refused, a failed sync, conflicts left by a sync, and a request to tidy a document converted from the old ledger. Name the thread by its slug, or by an old thread id listed in aliases.json; call list_threads to see each slug. full_briefing is accepted and changes nothing.",
  input: ResumeThreadInputSchema,
  output: ResumeThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const migrated = migrateIfNeeded(rt, paths.value)
    if (!migrated.ok) return { ok: false, refusal: migrated }
    const synced = await syncError(rt, paths.value)
    const slug = resolveThreadId(rt, paths.value, input.thread_id)
    if (!slug.ok) return { ok: false, refusal: slug }
    const file = workingCopyPath(paths.value, slug.value)
    if (!file.ok) return { ok: false, refusal: file }
    const reconciled = reconcileThread(rt, paths.value, slug.value)
    if (!('kind' in reconciled)) return { ok: false, refusal: reconciled }
    if (reconciled.kind === 'accepted') reconciled.push?.unref()
    const stored = readDocument(rt, paths.value, slug.value)
    if (stored === null) return { ok: false, refusal: unknownThread(input.thread_id) }
    const session = actingSession(paths.value, rt.sessionId)
    const hold = readHold(paths.value, slug.value)
    takeHold(rt, paths.value, slug.value, session, null)
    const mark = convertedPath(paths.value, slug.value)
    const converted = mark.ok && existsSync(mark.value)
    const recovery = recoveryLines(paths.value, slug.value, file.value, {
      hold,
      session,
      violations: reconciled.kind === 'refused' ? reconciled.violations : [],
      syncError: synced,
      documentText: stored.text,
      converted
    })
    if (mark.ok && converted) rmSync(mark.value, { force: true })
    return {
      ok: true,
      text: replyText(slug.value, file.value, stored.text, recovery),
      structured: { thread_id: slug.value, briefing: stored.text, path: file.value, recovery }
    }
  }
}
