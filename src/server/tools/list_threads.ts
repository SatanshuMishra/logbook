import { z } from 'zod'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { findRepository, startDirectory, type RepoPaths } from '../../thread/paths.ts'
import { listRoster, type Roster } from '../../thread/roster.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'list_threads'
const EMPTY_ROSTER = 'This repository has no threads; call open_thread to start one.'

const ListThreadsInputSchema = z
  .strictObject({
    include_closed: z
      .boolean()
      .optional()
      .describe(
        'true lists the done and abandoned threads too, after the open ones; omit it or send false to list only the open threads and count the closed ones'
      )
  })
  .describe('optionally include_closed, to list the closed threads after the open ones')

const RosterThreadSchema = z.object({
  thread_id: z.string().describe("the thread's slug, the thread_id every tool takes"),
  title: z.string().describe("the title of the thread's state document, or unreadable when it has none"),
  status: z
    .string()
    .describe(
      'the Status line of the thread\'s state document, such as active or "blocked: the owner", or unreadable when that line cannot be read'
    ),
  next_step: z
    .string()
    .describe(
      "the first sentence of the thread's next step, or 'read the working copy.' when its uncommitted working copy changes the next step"
    ),
  path: z.string().describe("the working copy of the thread's state document")
})

const ListThreadsOutputSchema = z.object({
  threads: z
    .array(RosterThreadSchema)
    .describe('the open threads, newest last commit first, followed by the closed threads when include_closed is true'),
  closed_count: z.number().describe('how many threads are done or abandoned, whether or not they are listed')
})

type ListThreadsInput = z.infer<typeof ListThreadsInputSchema>
type ListThreadsOutput = z.infer<typeof ListThreadsOutputSchema>

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

const structuredOf = (roster: Roster): ListThreadsOutput => ({
  threads: roster.threads.map((thread) => ({
    thread_id: thread.slug,
    title: thread.title,
    status: thread.status,
    next_step: thread.nextStep,
    path: thread.path
  })),
  closed_count: roster.closedCount
})

export const listThreadsTool: ToolSpec<ListThreadsInput, ListThreadsOutput> = {
  name: TOOL_NAME,
  title: 'List threads',
  description:
    'Lists the threads of this repository, one line each: its slug, its status and the first sentence of its next step. Open threads come first, newest last commit first, followed by a count of the done and abandoned threads; send include_closed true to list those too. A thread whose Status line cannot be read is listed as unreadable. Call resume_thread with a slug to continue that thread.',
  input: ListThreadsInputSchema,
  output: ListThreadsOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const roster = listRoster(rt, paths.value, { includeClosed: input.include_closed ?? false })
    return { ok: true, text: roster.text === '' ? EMPTY_ROSTER : roster.text, structured: structuredOf(roster) }
  }
}
