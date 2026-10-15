import { z } from 'zod'
import { LETTER_SECTION, parseDocument } from '../../doc/document.ts'
import { addItem, oneLine, removeItem } from '../../doc/render.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { findRepository, startDirectory, type RepoPaths } from '../../thread/paths.ts'
import { applyToolChange } from '../../thread/reconcile.ts'
import { resolveThreadId } from '../../thread/store.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'record_decision'
const NOT_BLANK = /\S/
const DECISION_ID = /^D[1-9][0-9]*$/

const filledText = (description: string) => z.string().regex(NOT_BLANK).describe(description)

const RecordDecisionInputSchema = z
  .strictObject({
    thread_id: z
      .string()
      .describe("the thread's slug, or an old thread id listed in aliases.json; call list_threads to see each slug"),
    title: filledText('a one-line title for the decision; refused when empty or only whitespace'),
    context: filledText(
      'what forced this choice: the situation that made a decision necessary; refused when empty or only whitespace'
    ),
    options: z
      .array(filledText('one option that was on the table; refused when empty or only whitespace'))
      .min(2)
      .describe(
        'the options that were on the table, at least two, for example ["retry in the client", "retry inside charge()"]'
      ),
    option_reasons: z
      .array(filledText('the reason for the option at the same position in options; refused when empty or only whitespace'))
      .optional()
      .describe(
        'one reason per option, in the same order as options, saying for each option why it was or was not chosen; refused when its count differs from options; omit it to record no reasons'
      ),
    outcome: filledText('which option was chosen and why; refused when empty or only whitespace'),
    supersedes: z
      .array(
        z
          .string()
          .regex(DECISION_ID)
          .describe('the id of a decision listed under "## Decisions in force" that this decision replaces, such as D1')
      )
      .optional()
      .describe('the decisions in force this decision replaces; each is removed from the document; omit it when it replaces none')
  })
  .superRefine((input, ctx) => {
    const reasons = input.option_reasons
    const count = input.options.length
    if (reasons === undefined || reasons.length === count) return
    const message = `option_reasons carries ${reasons.length} reasons for ${count} options`
    ctx.addIssue(
      reasons.length > count
        ? { code: 'too_big', origin: 'array', maximum: count, inclusive: true, path: ['option_reasons'], message, input: reasons }
        : { code: 'too_small', origin: 'array', minimum: count, inclusive: true, path: ['option_reasons'], message, input: reasons }
    )
  })

const RecordDecisionOutputSchema = z.object({
  thread_id: z.string().describe('the slug of the thread the decision was added to'),
  decision_id: z.string().describe('the id of the new decision in force, such as D3'),
  removed: z
    .array(z.string())
    .describe('the ids of the decisions this one superseded, each removed from Decisions in force')
})

type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>
type RecordDecisionOutput = z.infer<typeof RecordDecisionOutputSchema>

type Recorded =
  | { ok: true; decisionId: string; text: string; summary: string; details: string[]; noteLines: string[] }
  | { ok: false; refusal: Refusal }

type Removal = { ok: true; text: string; noteLines: string[] } | { ok: false; message: string }

const noWorkingDirectory = (): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a readable working directory inside a git repository, or CLAUDE_PROJECT_DIR naming one',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: 'logbook could not read its working directory and CLAUDE_PROJECT_DIR is not set, so it cannot find the repository'
})

const notInForce = (index: number, id: string): Refusal => ({
  ok: false,
  field: `supersedes.${index}`,
  accepted: 'the id of a decision listed under "## Decisions in force" in the thread\'s document, such as D1',
  example: 'D1',
  retryable: true,
  message: `${id} is not a decision in force on this thread, so nothing was committed; read the thread's document for the D ids under "## Decisions in force"`
})

const documentRefused = (message: string): Refusal => ({
  ok: false,
  field: 'document',
  accepted: 'a stored document holding every section of the state document format',
  example: '## Decisions in force',
  retryable: false,
  message: `${message}, so nothing was committed`
})

const locate = (rt: Runtime): Ok<RepoPaths> | Refusal => {
  const dir = startDirectory(rt, rt.cwd ?? '')
  return dir === '' ? noWorkingDirectory() : findRepository(rt, dir)
}

const decisionsInForce = (text: string): ReadonlySet<string> =>
  new Set(
    parseDocument(text)
      .items.filter((item) => item.letter === 'D' && item.section === LETTER_SECTION.D)
      .map((item) => item.id)
  )

const optionLine = (option: string, reason: string | undefined): string =>
  reason === undefined ? `Option: ${oneLine(option)}` : `Option: ${oneLine(option)} - ${oneLine(reason)}`

const withoutSuperseded = (text: string, ids: readonly string[], by: string): Removal =>
  ids.reduce<Removal>(
    (state, id) => {
      if (!state.ok) return state
      const removed = removeItem(state.text, id, `superseded by ${by}`)
      if (!removed.ok) return { ok: false, message: removed.message }
      return {
        ok: true,
        text: removed.text,
        noteLines: removed.noteLine === null ? state.noteLines : [...state.noteLines, removed.noteLine]
      }
    },
    { ok: true, text, noteLines: [] }
  )

const recordIn = (text: string, input: RecordDecisionInput): Recorded => {
  const supersedes = input.supersedes ?? []
  const inForce = decisionsInForce(text)
  const missing = supersedes.findIndex((id) => !inForce.has(id))
  const missingId = supersedes[missing]
  if (missingId !== undefined) return { ok: false, refusal: notInForce(missing, missingId) }
  const added = addItem(text, 'D', `${oneLine(input.title)}: ${oneLine(input.outcome)}`)
  if (!added.ok) return { ok: false, refusal: documentRefused(added.message) }
  if (added.id === null) return { ok: false, refusal: documentRefused('the decision was given no id') }
  const decisionId = added.id
  const removal = withoutSuperseded(added.text, [...new Set(supersedes)], decisionId)
  if (!removal.ok) return { ok: false, refusal: documentRefused(removal.message) }
  return {
    ok: true,
    decisionId,
    text: removal.text,
    summary: `${decisionId} ${oneLine(input.title)}`,
    details: [
      `Context: ${oneLine(input.context)}`,
      ...input.options.map((option, index) => optionLine(option, input.option_reasons?.[index])),
      `Outcome: ${oneLine(input.outcome)}`
    ],
    noteLines: removal.noteLines
  }
}

export const recordDecisionTool: ToolSpec<RecordDecisionInput, RecordDecisionOutput> = {
  name: TOOL_NAME,
  title: 'Record decision',
  description:
    'Adds one decision in force to a thread\'s document, as the line "- D<n> <title>: <outcome>", and keeps the context, every option with its reason and the outcome in the commit message. Whoever chose between the options records the choice. It takes the thread, a one-line title, the situation that forced the choice, at least two options that were on the table, optionally one reason per option in the same order, and the outcome. A decision that replaces earlier ones names their D ids in supersedes; each of those lines is removed from Decisions in force with a note naming the decision that superseded it. Returns the new decision\'s id.',
  input: RecordDecisionInputSchema,
  output: RecordDecisionOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const slug = resolveThreadId(rt, paths.value, input.thread_id)
    if (!slug.ok) return { ok: false, refusal: slug }
    let decisionId: string | null = null
    const applied = applyToolChange(rt, paths.value, slug.value, {
      tool: TOOL_NAME,
      change: (text) => {
        const recorded = recordIn(text, input)
        if (recorded.ok) decisionId = recorded.decisionId
        return recorded
      }
    })
    if (!applied.ok) return { ok: false, refusal: applied }
    applied.value.push?.unref()
    const recordedId = decisionId ?? ''
    return {
      ok: true,
      text: `recorded decision ${recordedId} on thread ${slug.value}`,
      structured: { thread_id: slug.value, decision_id: recordedId, removed: applied.value.removed }
    }
  }
}
