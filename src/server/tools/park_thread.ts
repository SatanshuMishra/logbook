import { z } from 'zod'
import { parseDocument, type Status } from '../../doc/document.ts'
import { oneLine, replaceSection, setStatus } from '../../doc/render.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { actingSession, heldBy, releaseHold } from '../../thread/holds.ts'
import { findRepository, startDirectory, workingCopyPath, type RepoPaths } from '../../thread/paths.ts'
import { applyToolChange, type ToolChange } from '../../thread/reconcile.ts'
import { readAliases, resolveThreadId } from '../../thread/store.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'park_thread'
const NOT_BLANK = /\S/
const NEXT_STEP_SECTION = 'Next step'
const PARKED = 'parked'
const RECORDS_ACCEPTED = 'ids of items in the document, such as D3 or R1'

const ParkThreadInputSchema = z
  .strictObject({
    thread_id: z
      .string()
      .optional()
      .describe(
        "the thread's slug, or an old thread id listed in aliases.json; omit it to park the thread this session holds"
      ),
    outcome: z
      .string()
      .optional()
      .describe(
        'what this session achieved, written on one line as the line of the commit after its first; omit it to park with no outcome'
      ),
    next_step: z
      .string()
      .regex(NOT_BLANK)
      .optional()
      .describe(
        `replaces the body of "## ${NEXT_STEP_SECTION}": one action someone could begin without re-deriving anything; refused when empty or only whitespace; omit it to leave the next step as it is`
      ),
    next_step_records: z
      .array(z.string().describe('the id of one item of the document, such as D3 or R1'))
      .optional()
      .describe(
        'the ids of the document\'s items the next step needs, such as ["D3", "R1"], written after the next step as "Needs: D3, R1."; refused without next_step, and refused when it names an id the document does not hold'
      )
  })
  .superRefine((input, ctx) => {
    if (input.next_step_records !== undefined && input.next_step === undefined) {
      ctx.addIssue({
        code: 'invalid_value',
        values: [],
        path: ['next_step_records'],
        message: 'next_step_records was sent without next_step',
        input: input.next_step_records
      })
    }
  })
  .describe(
    'the thread to park, or none to park the thread this session holds, with an optional outcome and an optional next_step and its next_step_records'
  )

const ParkThreadOutputSchema = z.object({
  parked_thread_ids: z
    .array(z.string())
    .describe("the parked thread's slug, followed by each old thread id that aliases.json maps to it")
})

type ParkThreadInput = z.infer<typeof ParkThreadInputSchema>
type ParkThreadOutput = z.infer<typeof ParkThreadOutputSchema>

const noWorkingDirectory = (): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a readable working directory inside a git repository, or CLAUDE_PROJECT_DIR naming one',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: 'logbook could not read its working directory and CLAUDE_PROJECT_DIR is not set, so it cannot find the repository'
})

const nothingHeld = (): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: "the slug of a thread, or an old thread id listed in aliases.json; it may be omitted only while this session holds a thread",
  example: 'fix-login',
  retryable: true,
  message:
    'no thread_id was named and this session holds no thread, so nothing was parked; name the thread to park, and call list_threads to see each slug'
})

const closedThread = (slug: string, status: Status): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'a thread whose status is not done or abandoned',
  example: 'fix-login',
  retryable: false,
  message: `the thread ${slug} is closed (Status: ${status.raw}), so nothing was committed; a closed thread is not parked`
})

const unknownRecords = (ids: readonly string[]): Refusal => ({
  ok: false,
  field: 'next_step_records',
  accepted: RECORDS_ACCEPTED,
  example: 'D1',
  retryable: true,
  message: `${ids.map((id) => JSON.stringify(id)).join(', ')} ${ids.length === 1 ? 'is not an item' : 'are not items'} of the thread's document, so nothing was committed; name the c, D, R or S ids the document holds`
})

const documentRefused = (message: string): Refusal => ({
  ok: false,
  field: 'document',
  accepted: 'a stored document holding every section of the state document format',
  example: `## ${NEXT_STEP_SECTION}`,
  retryable: false,
  message: `${message}, so nothing was committed`
})

const locate = (rt: Runtime): Ok<RepoPaths> | Refusal => {
  const dir = startDirectory(rt, rt.cwd ?? '')
  return dir === '' ? noWorkingDirectory() : findRepository(rt, dir)
}

const targetOf = (rt: Runtime, paths: RepoPaths, threadId: string | undefined): Ok<string> | Refusal => {
  if (threadId !== undefined) return resolveThreadId(rt, paths, threadId)
  const held = heldBy(paths, actingSession(paths, rt.sessionId))
  return held === null ? nothingHeld() : { ok: true, value: held }
}

const isClosed = (status: Status | null): status is Status => status?.kind === 'done' || status?.kind === 'abandoned'

const unique = (ids: readonly string[]): string[] => [...new Set(ids)]

const nextStepBody = (nextStep: string, records: readonly string[]): string[] =>
  records.length === 0 ? [nextStep] : [nextStep, '', `Needs: ${records.join(', ')}.`]

const outcomeLines = (outcome: string | undefined): string[] =>
  outcome === undefined || outcome.trim() === '' ? [] : [oneLine(outcome)]

const withNextStep = (text: string, input: ParkThreadInput): Ok<string> | Refusal => {
  if (input.next_step === undefined) return { ok: true, value: text }
  const records = unique(input.next_step_records ?? [])
  const known = new Set(parseDocument(text).items.map((item) => item.id))
  const missing = records.filter((id) => !known.has(id))
  if (missing.length > 0) return unknownRecords(missing)
  const replaced = replaceSection(text, NEXT_STEP_SECTION, nextStepBody(input.next_step, records))
  return replaced.ok ? { ok: true, value: replaced.text } : documentRefused(replaced.message)
}

const parkChange =
  (slug: string, input: ParkThreadInput): ToolChange =>
  (text) => {
    const status = parseDocument(text).status
    if (isClosed(status)) return { ok: false, refusal: closedThread(slug, status) }
    const parked = setStatus(text, PARKED)
    if (!parked.ok) return { ok: false, refusal: documentRefused(parked.message) }
    const stepped = withNextStep(parked.text, input)
    if (!stepped.ok) return { ok: false, refusal: stepped }
    return { ok: true, text: stepped.value, summary: PARKED, details: outcomeLines(input.outcome), noteLines: [] }
  }

const parkedIds = (rt: Runtime, paths: RepoPaths, slug: string): string[] => {
  const aliases = readAliases(rt, paths)
  return [slug, ...Object.keys(aliases).filter((id) => aliases[id] === slug)]
}

export const parkThreadTool: ToolSpec<ParkThreadInput, ParkThreadOutput> = {
  name: TOOL_NAME,
  title: 'Park thread',
  description: `Sets a thread's status to parked in one commit and releases the session's hold on it, so the thread waits in the roster for the next session. Name the thread with thread_id, or omit it to park the thread this session holds. outcome, when given, is kept in the commit. next_step replaces the body of "## ${NEXT_STEP_SECTION}", followed by the line "Needs: <ids>." when next_step_records names the items of the document that step needs. A thread that is done or abandoned is refused. Returns the parked thread's slug and each old thread id that maps to it.`,
  input: ParkThreadInputSchema,
  output: ParkThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const slug = targetOf(rt, paths.value, input.thread_id)
    if (!slug.ok) return { ok: false, refusal: slug }
    const file = workingCopyPath(paths.value, slug.value)
    if (!file.ok) return { ok: false, refusal: file }
    const applied = applyToolChange(rt, paths.value, slug.value, { tool: TOOL_NAME, change: parkChange(slug.value, input) })
    if (!applied.ok) return { ok: false, refusal: applied }
    applied.value.push?.unref()
    releaseHold(rt, paths.value, slug.value)
    return {
      ok: true,
      text: `parked thread ${slug.value}\n${file.value}`,
      structured: { parked_thread_ids: parkedIds(rt, paths.value, slug.value) }
    }
  }
}
