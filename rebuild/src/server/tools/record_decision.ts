import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { DecisionRecord, type Decision } from '../../schema/decision.ts'
import { readProjectHead } from '../../store/git.ts'
import { withDetail } from '../../store/detail.ts'
import { openProjectStore, loadThread } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const RecordDecisionInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread this decision belongs to; the thread must currently be open'),
  title: z.string().min(1).max(caps.DECISION_TITLE_MAX).describe('a one-line title for the decision'),
  context: z.string().max(caps.DECISION_CONTEXT_MAX).describe('the situation that forced this choice'),
  options: z
    .array(z.string().max(caps.DECISION_OPTION_MAX).describe('one option that was on the table'))
    .max(caps.DECISION_OPTIONS_MAX_ELEMENTS)
    .describe('the options that were on the table, for example ["ship the fast path", "keep the safe default"]'),
  outcome: z.string().max(caps.DECISION_OUTCOME_MAX).describe('the outcome that was chosen and why'),
  supersedes: z
    .array(ulidField('the id of a decision this new one reverses or replaces'))
    .max(caps.DECISION_SUPERSEDES_MAX_ELEMENTS)
    .optional()
    .describe('decision ids this new decision supersedes; omit or send an empty array when this decision supersedes nothing')
})

const RecordDecisionOutputSchema = z.object({
  decision_id: z.string().describe('the id minted for the new decision record'),
  thread_id: z.string().describe('the id of the thread the decision was recorded against'),
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read')
})

type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>
type RecordDecisionOutput = z.infer<typeof RecordDecisionOutputSchema>

export const titleCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'title',
  accepted: `at most ${caps.DECISION_TITLE_MAX} characters after escaping`,
  example: 'ship the fast path for the merge queue',
  retryable: true,
  message: `title exceeds its cap of ${caps.DECISION_TITLE_MAX} characters after escaping; observed ${observed}; remedy: shorten the title and retry.`
})

export const contextCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'context',
  accepted: `at most ${caps.DECISION_CONTEXT_MAX} characters after escaping`,
  example: 'the merge queue was blocking every other thread',
  retryable: true,
  message: `context exceeds its cap of ${caps.DECISION_CONTEXT_MAX} characters after escaping; observed ${observed}; remedy: shorten the context and retry.`
})

export const outcomeCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: `at most ${caps.DECISION_OUTCOME_MAX} characters after escaping`,
  example: 'shipped the fast path; the safe default stayed available behind a flag',
  retryable: true,
  message: `outcome exceeds its cap of ${caps.DECISION_OUTCOME_MAX} characters after escaping; observed ${observed}; remedy: shorten the outcome and retry.`
})

export const optionCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'options',
  accepted: `at most ${caps.DECISION_OPTION_MAX} characters after escaping, per option`,
  example: 'ship the fast path',
  retryable: true,
  message: `options[${index}] exceeds its cap of ${caps.DECISION_OPTION_MAX} characters after escaping; observed ${observed}; remedy: shorten the option text and retry.`
})

export const invalidDecisionRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'decision',
  accepted: 'a decision record that stays within its stored-shape caps',
  example: 'shorten the title, context, outcome or options and retry',
  retryable: true,
  message: `the decision record failed its stored-shape validation: ${issue}`
})

export const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'decision',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for this decision did not complete; retry the call.'
    },
    detail
  )

export const recordDecisionTool: ToolSpec<RecordDecisionInput, RecordDecisionOutput> = {
  name: 'record_decision',
  title: 'Record decision',
  description:
    "Writes down one decision the moment it is made, with the reasoning that produced it, and returns the new record's id. Takes the thread it belongs to, a one-line title, the situation that forced the choice, the options that were on the table as a list of strings, and the outcome that was chosen. A decision cannot be edited afterwards by any tool here; reversing one means recording a new decision that names the old one in supersedes, and the old record stays readable. It also stores the project's current commit, so a later reader can see what the code looked like when this was settled.",
  input: RecordDecisionInputSchema,
  output: RecordDecisionOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const escapedTitle = escapeStored(input.title)
    if (escapedTitle.length > caps.DECISION_TITLE_MAX) {
      return { ok: false, refusal: titleCapRefusal(escapedTitle.length) }
    }

    const escapedContext = escapeStored(input.context)
    if (escapedContext.length > caps.DECISION_CONTEXT_MAX) {
      return { ok: false, refusal: contextCapRefusal(escapedContext.length) }
    }

    const escapedOutcome = escapeStored(input.outcome)
    if (escapedOutcome.length > caps.DECISION_OUTCOME_MAX) {
      return { ok: false, refusal: outcomeCapRefusal(escapedOutcome.length) }
    }

    const escapedOptions = input.options.map((option) => escapeStored(option))
    const oversizedIndex = escapedOptions.findIndex((option) => option.length > caps.DECISION_OPTION_MAX)
    if (oversizedIndex !== -1) {
      const oversizedOption = escapedOptions[oversizedIndex]
      return { ok: false, refusal: optionCapRefusal(oversizedIndex, oversizedOption === undefined ? 0 : oversizedOption.length) }
    }

    const commit = readProjectHead(rt, rt.cwd)

    const decision: Decision = {
      id: rt.ulid(),
      thread_id: thread.id,
      title: escapedTitle,
      context: escapedContext,
      options: escapedOptions,
      outcome: escapedOutcome,
      commit,
      supersedes: input.supersedes ?? [],
      created_at: rt.now()
    }

    const validated = DecisionRecord.parse(decision)
    if (!validated.ok) {
      return { ok: false, refusal: invalidDecisionRefusal(validated.message) }
    }

    const committed = store.commit([{ kind: 'decision', record: validated.value }], `record decision ${validated.value.id} on thread ${thread.slug}`)
    if (!committed.ok) {
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    return {
      ok: true,
      text: `recorded decision ${validated.value.id} on thread ${thread.slug}.`,
      structured: { decision_id: validated.value.id, thread_id: thread.id, commit: validated.value.commit }
    }
  }
}
