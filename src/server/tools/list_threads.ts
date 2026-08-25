import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { selectRosterThreads, toRosterRow, paginateRoster, renderRoster, type RosterRow } from '../../render/roster.ts'
import { openProjectStore } from '../tool-support.ts'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

const ListThreadsInputSchema = z.strictObject({
  cursor: z
    .string()
    .optional()
    .describe(
      'the id of the last row from a previous list_threads reply; resume reading immediately after that row, omit to read the first page'
    ),
  limit: z
    .number()
    .int()
    .optional()
    .describe(`how many rows to return on this page; defaults to ${DEFAULT_PAGE_SIZE}, cannot exceed ${MAX_PAGE_SIZE}`)
})

const RosterRowSchema = z.object({
  id: z.string().describe('the id of this thread, a 26-character ULID'),
  slug: z.string().describe('the short lowercase label for this thread'),
  title: z.string().describe('the thread title'),
  blocked_by: z.string().nullable().describe('the reason this thread is blocked, or null when it is not blocked'),
  criteria_done: z.number().describe('how many un-struck completion criteria are marked done'),
  criteria_total: z.number().describe('how many un-struck completion criteria this thread carries in total'),
  next_step: z.string().describe('the single next action the last session left for this thread'),
  updated_at: z.string().describe('when this thread was last updated, an ISO-8601 timestamp')
})

const ListThreadsOutputSchema = z.object({
  threads: z.array(RosterRowSchema).describe('the rows on this page of the roster, newest activity first'),
  next_cursor: z
    .string()
    .nullable()
    .describe('pass this back as cursor to read the next page, or null when this page reaches the end'),
  total: z.number().describe('how many threads are in the whole resumable roster, not just this page')
})

type ListThreadsInput = z.infer<typeof ListThreadsInputSchema>
type ListThreadsOutput = z.infer<typeof ListThreadsOutputSchema>

const limitOutOfRangeRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'limit',
  accepted: `an integer between 1 and ${MAX_PAGE_SIZE}`,
  example: String(DEFAULT_PAGE_SIZE),
  retryable: true,
  message: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}; received ${observed}.`
})

const unknownCursorRefusal = (cursor: string | null): Refusal => ({
  ok: false,
  field: 'cursor',
  accepted: 'the id of the last row from a previous list_threads reply',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `cursor does not match any row currently in the roster; received ${cursor}. The roster may have changed since the previous page was read; call list_threads again with cursor omitted to restart from the first page.`
})

export const listThreadsTool: ToolSpec<ListThreadsInput, ListThreadsOutput> = {
  name: 'list_threads',
  title: 'List threads',
  description:
    'Lists the threads that can be picked up, newest activity first, each with its state, how far along it is, and the single next action the last session left. Takes no required arguments; pass `cursor` from a previous reply to read the next page, and `limit` to change the page size from its default of 25. A thread that is blocked shows what it is blocked on, because a blocked thread with no reason is worse than no thread at all. This is a plain directory read and costs nothing worth avoiding.',
  input: ListThreadsInputSchema,
  output: ListThreadsOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const limit = input.limit ?? DEFAULT_PAGE_SIZE
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      return { ok: false, refusal: limitOutOfRangeRefusal(limit) }
    }

    const slots = store.readThreads()
    for (const slot of slots) {
      if (slot.quarantined) {
        rt.log({ level: 'error', event: 'roster.thread-quarantined', path: slot.path, reason: slot.reason })
      }
    }

    const threads = slots.flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
    const rows: RosterRow[] = selectRosterThreads(threads).map(toRosterRow)

    const cursor = input.cursor ?? null
    const paginated = paginateRoster(rows, cursor, limit)
    if (!paginated.ok) {
      return { ok: false, refusal: unknownCursorRefusal(cursor) }
    }

    return {
      ok: true,
      text: renderRoster(paginated.page),
      structured: {
        threads: paginated.page.rows,
        next_cursor: paginated.page.next_cursor,
        total: paginated.page.total
      }
    }
  }
}
