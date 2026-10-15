import { z } from 'zod'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { findRepository, startDirectory, type RepoPaths } from '../../thread/paths.ts'
import { searchHistory, type SearchMatch } from '../../thread/roster.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'search_ledger'
const NOT_BLANK = /\S/
const SHORT_COMMIT_LENGTH = 8

const SearchLedgerInputSchema = z
  .strictObject({
    text: z
      .string()
      .regex(NOT_BLANK)
      .describe(
        'the text to look for, matched case-insensitively against every version of every thread document and against the archived ledger; refused when empty or only whitespace'
      )
  })
  .describe('the text to search the history for')

const SearchMatchSchema = z.object({
  commit: z.string().describe('the full id of a commit that added or removed the text'),
  date: z.string().describe("the commit's date, an ISO 8601 timestamp"),
  file: z.string().describe('a file the commit changed that holds the text, such as fix-login.md'),
  lines: z
    .array(z.string())
    .describe("the file's lines holding the text, from the commit's version, or its parent's when the commit removed it")
})

const SearchLedgerOutputSchema = z.object({
  matches: z
    .array(SearchMatchSchema)
    .describe('one entry per commit and file holding the text, newest commit first; empty when nothing matched')
})

type SearchLedgerInput = z.infer<typeof SearchLedgerInputSchema>
type SearchLedgerOutput = z.infer<typeof SearchLedgerOutputSchema>

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

const matchLines = (match: SearchMatch): string[] =>
  match.lines.map((line) => `${match.commit.slice(0, SHORT_COMMIT_LENGTH)} ${match.date} ${match.file}: ${line}`)

const textOf = (text: string, matches: readonly SearchMatch[]): string =>
  matches.length === 0
    ? `No version of a thread document and no record of the archived ledger holds ${JSON.stringify(text)}.`
    : matches.flatMap(matchLines).join('\n')

export const searchLedgerTool: ToolSpec<SearchLedgerInput, SearchLedgerOutput> = {
  name: TOOL_NAME,
  title: 'Search ledger',
  description:
    'Searches the whole history of this repository\'s threads, every version of every state document and the archived old ledger, for a text, ignoring case. Replies with one line per matching line: the commit\'s first 8 characters, its date, the file and the line, such as "3f2b7c1e 2026-10-14T09:00:00+00:00 fix-login.md: - D1 Use Postgres: ...". A line removed from a document is still found, in the commit that removed it.',
  input: SearchLedgerInputSchema,
  output: SearchLedgerOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const found = searchHistory(rt, paths.value, input.text)
    if (!found.ok) return { ok: false, refusal: found }
    return {
      ok: true,
      text: textOf(input.text, found.value),
      structured: {
        matches: found.value.map((match) => ({
          commit: match.commit,
          date: match.date,
          file: match.file,
          lines: match.lines
        }))
      }
    }
  }
}
