import { z } from 'zod'
import { LETTER_SECTION, parseDocument, type Status } from '../../doc/document.ts'
import { oneLine, setStatus } from '../../doc/render.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { releaseHold } from '../../thread/holds.ts'
import { findRepository, startDirectory, type RepoPaths } from '../../thread/paths.ts'
import { applyToolChange, type ToolChange } from '../../thread/reconcile.ts'
import { resolveThreadId } from '../../thread/store.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'close_thread'
const NOT_BLANK = /\S/

const CloseThreadInputSchema = z
  .strictObject({
    thread_id: z
      .string()
      .describe("the thread's slug, or an old thread id listed in aliases.json; call list_threads to see each slug"),
    outcome: z
      .enum(['done', 'abandoned'])
      .describe(
        `done when the work is finished, which needs every criterion under "## ${LETTER_SECTION.c}" ticked [x] or struck [~]; abandoned when it is no longer pursued`
      ),
    detail: z
      .string()
      .regex(NOT_BLANK)
      .describe(
        'what finished the thread, or why it was abandoned, written on one line as the line of the commit after its first and, for abandoned, after "abandoned: " on the Status line; refused when empty or only whitespace'
      )
  })
  .describe('the thread to close, whether it is done or abandoned, and the detail that says why')

const CloseThreadOutputSchema = z.object({
  thread_id: z.string().describe("the closed thread's slug"),
  status: z.string().describe('the value the Status line now holds: done, or abandoned: <detail>')
})

type CloseThreadInput = z.infer<typeof CloseThreadInputSchema>
type CloseThreadOutput = z.infer<typeof CloseThreadOutputSchema>

const noWorkingDirectory = (): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a readable working directory inside a git repository, or CLAUDE_PROJECT_DIR naming one',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: 'logbook could not read its working directory and CLAUDE_PROJECT_DIR is not set, so it cannot find the repository'
})

const closedThread = (slug: string, status: Status): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'a thread whose status is not done or abandoned',
  example: 'fix-login',
  retryable: false,
  message: `the thread ${slug} is closed (Status: ${status.raw}), so nothing was committed; a closed thread is not closed again`
})

const documentRefused = (message: string): Refusal => ({
  ok: false,
  field: 'document',
  accepted: 'a stored document holding a Status line after its title line',
  example: 'Status: active',
  retryable: false,
  message: `${message}, so nothing was committed`
})

const locate = (rt: Runtime): Ok<RepoPaths> | Refusal => {
  const dir = startDirectory(rt, rt.cwd ?? '')
  return dir === '' ? noWorkingDirectory() : findRepository(rt, dir)
}

const isClosed = (status: Status | null): status is Status => status?.kind === 'done' || status?.kind === 'abandoned'

const statusFor = (input: CloseThreadInput): string =>
  input.outcome === 'done' ? 'done' : `abandoned: ${oneLine(input.detail)}`

const closeChange =
  (slug: string, input: CloseThreadInput): ToolChange =>
  (text) => {
    const status = parseDocument(text).status
    if (isClosed(status)) return { ok: false, refusal: closedThread(slug, status) }
    const closed = setStatus(text, statusFor(input))
    if (!closed.ok) return { ok: false, refusal: documentRefused(closed.message) }
    return { ok: true, text: closed.text, summary: input.outcome, details: [oneLine(input.detail)], noteLines: [] }
  }

export const closeThreadTool: ToolSpec<CloseThreadInput, CloseThreadOutput> = {
  name: TOOL_NAME,
  title: 'Close thread',
  description: `Closes a thread in one commit and releases the session's hold on it: outcome done sets its status to done, and outcome abandoned sets it to "abandoned: <detail>". detail is kept in the commit either way. A done close is refused, with the open criteria named, while any criterion under "## ${LETTER_SECTION.c}" is still [ ]; tick it [x] with its evidence or strike it [~] with a reason first. A thread already done or abandoned is refused. Returns the thread's slug and its new status.`,
  input: CloseThreadInputSchema,
  output: CloseThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const slug = resolveThreadId(rt, paths.value, input.thread_id)
    if (!slug.ok) return { ok: false, refusal: slug }
    const applied = applyToolChange(rt, paths.value, slug.value, { tool: TOOL_NAME, change: closeChange(slug.value, input) })
    if (!applied.ok) return { ok: false, refusal: applied }
    applied.value.push?.unref()
    releaseHold(rt, paths.value, slug.value)
    return {
      ok: true,
      text: `closed thread ${slug.value} as ${input.outcome}`,
      structured: { thread_id: slug.value, status: statusFor(input) }
    }
  }
}
