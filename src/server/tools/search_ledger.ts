import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { indexRecords, normaliseForSearch, searchRecords, type SearchFilters } from '../../domain/record-index.ts'
import { renderSearch } from '../../render/briefing.ts'
import { openProjectStore } from '../tool-support.ts'

const SearchLedgerInputSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .optional()
    .describe(
      'words to look for, matched case-insensitively as exact characters in the record text, where any run of spaces or line breaks counts as one space; omit to list every record the other filters allow'
    ),
  kind: z
    .enum(['decision', 'risk', 'criterion', 'entry', 'artifact', 'out-of-scope'])
    .optional()
    .describe('only records of this kind; entry means a session log entry; omit for every kind'),
  thread: z
    .string()
    .optional()
    .describe('only records on this thread, given by id or slug; omit to search every thread, closed ones included'),
  status: z
    .enum(['live', 'all'])
    .optional()
    .describe(
      'live, the default, leaves out superseded decisions, retired risks and artifacts, and struck criteria; all includes them'
    )
})

const SearchLedgerOutputSchema = z.object({
  results: z
    .string()
    .describe('one line per matching record: kind, id, thread slug and status, and its title or first line'),
  matched: z.number().describe('how many records match the filters'),
  searched: z.number().describe('how many records were searched, on every thread and of every status'),
  threads: z.number().describe('how many threads the searched records sit on, closed threads included')
})

type SearchLedgerInput = z.infer<typeof SearchLedgerInputSchema>
type SearchLedgerOutput = z.infer<typeof SearchLedgerOutputSchema>

const filtersOf = (input: SearchLedgerInput): SearchFilters => ({
  ...(input.text === undefined ? {} : { text: input.text }),
  ...(input.kind === undefined ? {} : { kind: input.kind }),
  ...(input.thread === undefined ? {} : { thread: input.thread }),
  ...(input.status === undefined ? {} : { status: input.status })
})

export const searchLedgerTool: ToolSpec<SearchLedgerInput, SearchLedgerOutput> = {
  name: 'search_ledger',
  title: 'Search ledger',
  description:
    "Lists and searches this project's recorded decisions, risks, criteria, session entries, artifacts and out-of-scope notes across every thread, closed threads included, one line per record with its id. Use it before setting a next step, to find the records that step needs, and before recording something, to see whether it is already recorded. A decision is read in full at logbook://decision/{id}, and any record is shown in full when a next step names it in next_step_records. By default it lists live records only, leaving out superseded decisions, retired risks and artifacts, and struck criteria; set status to all to include them. A text search matches exact characters only, so finding nothing proves nothing: try other words, or list by kind or thread.",
  input: SearchLedgerInputSchema,
  output: SearchLedgerOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }

    if (input.text !== undefined && normaliseForSearch(input.text).length === 0) {
      return {
        ok: false,
        refusal: {
          ok: false,
          field: 'text',
          accepted: 'words to look for, holding at least one character that is not a space or line break',
          example: 'timeout',
          retryable: true,
          message:
            'text holds only spaces or line breaks, which would match every record; send words to look for, or leave text out to list every record the other filters allow.'
        }
      }
    }

    const result = searchRecords(indexRecords(opened.value), filtersOf(input))

    return {
      ok: true,
      text: '',
      structured: {
        results: renderSearch(result),
        matched: result.records.length,
        searched: result.searched,
        threads: result.threads
      }
    }
  }
}
