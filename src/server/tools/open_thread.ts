import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { LETTER_SECTION } from '../../doc/document.ts'
import { newDocument } from '../../doc/render.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { SLUG_PATTERN } from '../../schema/ids.ts'
import { durableWrite } from '../../store/durable-write.ts'
import { actingSession, foldHold, takeHold } from '../../thread/holds.ts'
import { migrateIfNeeded } from '../../thread/migrate.ts'
import { findRepository, startDirectory, workingCopyPath, type RepoPaths } from '../../thread/paths.ts'
import { startPush } from '../../thread/reconcile.ts'
import { commitDocuments, readDocument } from '../../thread/store.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'open_thread'
const NOT_BLANK = /\S/
const SLUG_MAX_LENGTH = 64
const DONE_WHEN = LETTER_SECTION.c

const filledText = (description: string) => z.string().regex(NOT_BLANK).describe(description)

const OpenThreadInputSchema = z
  .strictObject({
    slug: z
      .string()
      .regex(SLUG_PATTERN)
      .max(SLUG_MAX_LENGTH)
      .describe(
        `the thread's name, unique in this repository: lowercase letters, digits and hyphens, starting with a letter or digit, at most ${SLUG_MAX_LENGTH} characters, for example fix-login`
      ),
    title: filledText('what the work is, in one line; refused when empty or only whitespace'),
    goal: filledText(
      'what the work is trying to achieve, in one or two sentences a fresh session can act on; refused when empty or only whitespace'
    ),
    next_step: filledText(
      'the next action, one someone could begin without re-deriving anything; refused when empty or only whitespace'
    ),
    criteria: z
      .array(filledText('one thing that must be true for the work to be done; refused when empty or only whitespace'))
      .optional()
      .describe(
        `what must be true for the work to be done, written in the given order under "## ${DONE_WHEN}" as c1, c2 and so on; omit it when done is not known yet`
      ),
    details: z
      .array(
        filledText(
          'one line saying where more about the work lives, such as "Spec: docs/specs/login.md"; refused when empty or only whitespace'
        )
      )
      .optional()
      .describe('where the details of the work live, each written as one line under "## Where the details live"')
  })
  .describe('the new thread: slug, title, goal and next_step, and optionally criteria and details')

const OpenThreadOutputSchema = z.object({
  thread_id: z.string().describe('the slug of the thread that was opened'),
  path: z.string().describe("the working copy of the thread's state document, the file to edit with the Edit tool")
})

type OpenThreadInput = z.infer<typeof OpenThreadInputSchema>
type OpenThreadOutput = z.infer<typeof OpenThreadOutputSchema>

const noWorkingDirectory = (): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a readable working directory inside a git repository, or CLAUDE_PROJECT_DIR naming one',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: 'logbook could not read its working directory and CLAUDE_PROJECT_DIR is not set, so it cannot find the repository'
})

const slugTaken = (slug: string): Refusal => ({
  ok: false,
  field: 'slug',
  accepted: 'a slug no thread in this repository has yet',
  example: `${slug}-2`,
  retryable: true,
  message: `thread ${slug} already exists, so nothing was written; call resume_thread with thread_id ${slug} to pick it up, or open a new thread under another slug`
})

const locate = (rt: Runtime): Ok<RepoPaths> | Refusal => {
  const dir = startDirectory(rt, rt.cwd ?? '')
  return dir === '' ? noWorkingDirectory() : findRepository(rt, dir)
}

const writeWorkingCopy = (rt: Runtime, file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  durableWrite(file, text, { log: rt.log })
}

const openedText = (slug: string, file: string): string =>
  `opened thread ${slug}. Its state document is ${file}. Keep it true by editing that file with the Edit tool.`

export const openThreadTool: ToolSpec<OpenThreadInput, OpenThreadOutput> = {
  name: TOOL_NAME,
  title: 'Open thread',
  description: `Starts a new thread of work and makes this session its holder. The thread's state document is the one record of the work: its goal, what must be true for it to be done, where things stand, the next step, the decisions in force, the open risks, what is settled and where the details live. Send a slug unique in this repository, a one-line title, the goal and the next step, and optionally criteria and details. Criteria are what must be true for the work to be done; each is written under "## ${DONE_WHEN}" as c1, c2 and so on, in the order given. Details are lines saying where more about the work lives, such as a spec path. Each text is written on one line. The reply names the working copy of the document; keep the document true by editing that file with the Edit tool whenever logbook asks you to. A slug that already has a document is refused; call resume_thread to pick that thread up.`,
  input: OpenThreadInputSchema,
  output: OpenThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const file = workingCopyPath(paths.value, input.slug)
    if (!file.ok) return { ok: false, refusal: file }
    const migrated = migrateIfNeeded(rt, paths.value)
    if (!migrated.ok) return { ok: false, refusal: migrated }
    if (readDocument(rt, paths.value, input.slug) !== null) return { ok: false, refusal: slugTaken(input.slug) }
    const now = rt.now()
    const text = newDocument({
      slug: input.slug,
      title: input.title,
      goal: input.goal,
      nextStep: input.next_step,
      criteria: input.criteria ?? [],
      details: input.details ?? [],
      now
    })
    const committed = commitDocuments(rt, paths.value, {
      changes: [{ slug: input.slug, text, expectedBlob: null }],
      message: `${TOOL_NAME} ${input.slug}: opened`
    })
    if (!committed.ok) return { ok: false, refusal: 'cause' in committed ? slugTaken(input.slug) : committed }
    writeWorkingCopy(rt, file.value, text)
    takeHold(rt, paths.value, input.slug, actingSession(paths.value, rt.sessionId), null)
    foldHold(rt, paths.value, input.slug, now)
    startPush(rt, paths.value)?.unref()
    return {
      ok: true,
      text: openedText(input.slug, file.value),
      structured: { thread_id: input.slug, path: file.value }
    }
  }
}
