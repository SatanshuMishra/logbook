import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { DecisionRecord, type Decision } from '../../schema/decision.ts'
import { ThreadRecord, type KeyDecision, type Thread } from '../../schema/thread.ts'
import type { RecordChange } from '../../store/write-path.ts'
import { readProjectHead } from '../../store/git.ts'
import { withDetail } from '../../store/detail.ts'
import { openProjectStore, loadThread, decisionResolver } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const RecordDecisionInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread this decision belongs to; the thread must currently be open'),
  title: z.string().min(1).describe('a one-line title for the decision'),
  context: z
    .string()
    .describe('what forced this choice: the situation that made a decision necessary; refused when empty or only whitespace'),
  options: z
    .array(z.string().describe('one option that was on the table'))
    .max(caps.DECISION_OPTIONS_MAX_ELEMENTS)
    .describe(
      'the options that were on the table, at least two, for example ["ship the fast path", "keep the safe default"]; refused with fewer than two or with an option that is empty or only whitespace'
    ),
  option_reasons: z
    .array(z.string().describe('the reason for the option at the same position in options'))
    .max(caps.DECISION_OPTIONS_MAX_ELEMENTS)
    .optional()
    .describe(
      'one reason per option, in the same order as options, saying for each option why it was or was not chosen; refused when its length differs from options or a reason is empty or only whitespace; omit it to record no reasons'
    ),
  outcome: z
    .string()
    .describe('which option was chosen and why; refused when empty or only whitespace'),
  scope: z
    .string()
    .min(1)
    .optional()
    .describe(
      'the criterion or area of the thread this decision resolved, stored on the spine link; omit it and the decision is recorded with no particular scope'
    ),
  criterion_id: z
    .string()
    .regex(ULID_PATTERN)
    .optional()
    .describe(
      'the completion criterion this decision ranks against, stored on the spine link; refused when it names no criterion on this thread; omit it when the decision is not anchored to one criterion'
    ),
  supersedes: z
    .array(ulidField('the id of a decision this new one reverses or replaces'))
    .max(caps.DECISION_SUPERSEDES_MAX_ELEMENTS)
    .optional()
    .describe('decision ids this new decision supersedes; omit or send an empty array when this decision supersedes nothing')
})

const RecordDecisionOutputSchema = z.object({
  decision_id: z.string().describe('the id minted for the new decision record'),
  thread_id: z.string().describe('the id of the thread the decision was recorded against'),
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read'),
  scope: z
    .string()
    .nullable()
    .describe('the scope recorded on the spine link, or null when none was supplied'),
  linked: z.boolean().describe('whether this call also linked the decision into the thread running summary'),
  link_skipped_reason: z
    .string()
    .nullable()
    .describe('why the spine link was not written, or null when it was written')
})

type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>
type RecordDecisionOutput = z.infer<typeof RecordDecisionOutputSchema>

export const invalidDecisionRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'decision',
  accepted: 'a decision record that stays within its stored-shape caps',
  example: 'shorten the title or an option and retry',
  retryable: true,
  message: `the decision record failed its stored-shape validation: ${issue}`
})

const isBlank = (text: string): boolean => text.trim().length === 0

export const blankFieldRefusal = (field: 'context' | 'outcome'): Refusal => ({
  ok: false,
  field,
  accepted:
    field === 'context'
      ? 'a context that states what forced this choice, not empty and not only whitespace'
      : 'an outcome that states which option was chosen and why, not empty and not only whitespace',
  example:
    field === 'context'
      ? 'retries double-charge customers when the payment provider times out'
      : 'retry inside charge(), because only charges are idempotent',
  retryable: true,
  message: `${field} is empty or only whitespace; nothing was stored.`
})

export const tooFewOptionsRefusal = (received: number): Refusal => ({
  ok: false,
  field: 'options',
  accepted: 'at least two options that were on the table',
  example: '["retry in the client", "retry inside charge()"]',
  retryable: true,
  message: `options carries ${received} option${received === 1 ? '' : 's'}; a decision chooses between at least two, so nothing was stored.`
})

export const blankOptionRefusal = (index: number): Refusal => ({
  ok: false,
  field: 'options',
  accepted: 'options that each state a choice, none empty or only whitespace',
  example: '["retry in the client", "retry inside charge()"]',
  retryable: true,
  message: `options[${index}] is empty or only whitespace; nothing was stored.`
})

export const optionReasonsLengthRefusal = (reasons: number, options: number): Refusal => ({
  ok: false,
  field: 'option_reasons',
  accepted: 'exactly one reason per option, in the same order as options, or no option_reasons at all',
  example: '["retries every request, unsafe for payments", "chosen: only charges are idempotent"]',
  retryable: true,
  message: `option_reasons carries ${reasons} reason${reasons === 1 ? '' : 's'} for ${options} options; nothing was stored.`
})

export const blankOptionReasonRefusal = (index: number): Refusal => ({
  ok: false,
  field: 'option_reasons',
  accepted: 'reasons that each say why their option was or was not chosen, none empty or only whitespace',
  example: '["retries every request, unsafe for payments", "chosen: only charges are idempotent"]',
  retryable: true,
  message: `option_reasons[${index}] is empty or only whitespace; nothing was stored.`
})

const standardRefusal = (input: RecordDecisionInput): Refusal | null => {
  if (isBlank(input.context)) return blankFieldRefusal('context')
  if (input.options.length < 2) return tooFewOptionsRefusal(input.options.length)
  const blankOption = input.options.findIndex(isBlank)
  if (blankOption !== -1) return blankOptionRefusal(blankOption)
  if (input.option_reasons !== undefined) {
    if (input.option_reasons.length !== input.options.length) {
      return optionReasonsLengthRefusal(input.option_reasons.length, input.options.length)
    }
    const blankReason = input.option_reasons.findIndex(isBlank)
    if (blankReason !== -1) return blankOptionReasonRefusal(blankReason)
  }
  if (isBlank(input.outcome)) return blankFieldRefusal('outcome')
  return null
}

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

export const unknownCriterionRefusal = (id: string): Refusal => ({
  ok: false,
  field: 'criterion_id',
  accepted: 'a criterion_id that names a completion criterion already present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criterion_id names an id not present on this thread: ${id}.`
})

export const unresolvedSupersedesRefusal = (index: number, decisionId: string): Refusal => ({
  ok: false,
  field: 'supersedes',
  accepted: 'a decision id that resolves to a stored decision record',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `supersedes[${index}] does not resolve to a stored decision record; received ${decisionId}.`
})

export const recordDecisionTool: ToolSpec<RecordDecisionInput, RecordDecisionOutput> = {
  name: 'record_decision',
  title: 'Record decision',
  description:
    "Writes down one decision the moment it is made, with the reasoning that produced it, and returns the new record's id. Takes the thread it belongs to, a one-line title, the situation that forced the choice, the options that were on the table as a list of strings, and the outcome that was chosen. Whoever chose between the options records the choice. A decision needs a context and an outcome that are not blank and at least two options; option_reasons may give one reason per option, in the same order, saying why it was or was not chosen. A decision cannot be edited afterwards by any tool here; reversing one means recording a new decision that names the old one in supersedes, and the old record stays readable. It also stores the project's current commit, so a later reader can see what the code looked like when this was settled.",
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

    const substandard = standardRefusal(input)
    if (substandard !== null) return { ok: false, refusal: substandard }

    if (input.criterion_id !== undefined && !thread.completion_criteria.some((c) => c.id === input.criterion_id)) {
      return { ok: false, refusal: unknownCriterionRefusal(input.criterion_id) }
    }

    const supersedes = input.supersedes ?? []
    const resolveDecision = decisionResolver(store)
    const unresolvedIndex = supersedes.findIndex((decisionId) => !resolveDecision(decisionId))
    const unresolvedDecisionId = unresolvedIndex === -1 ? undefined : supersedes[unresolvedIndex]
    if (unresolvedDecisionId !== undefined) {
      return { ok: false, refusal: unresolvedSupersedesRefusal(unresolvedIndex, unresolvedDecisionId) }
    }

    const escapedTitle = escapeStored(input.title)
    const escapedOptions = input.options.map((option) => escapeStored(option))
    const escapedOptionReasons = input.option_reasons?.map((reason) => escapeStored(reason))

    const escapedScope = input.scope === undefined ? '' : escapeStored(input.scope)

    const commit = readProjectHead(rt, rt.cwd)
    const decisionId = rt.ulid()
    const createdAt = rt.now()

    const escapedContext = escapeStored(input.context)
    const escapedOutcome = escapeStored(input.outcome)

    const decision: Decision = {
      id: decisionId,
      thread_id: thread.id,
      title: escapedTitle,
      context: escapedContext,
      options: escapedOptions,
      ...(escapedOptionReasons === undefined ? {} : { option_reasons: escapedOptionReasons }),
      outcome: escapedOutcome,
      commit,
      supersedes,
      created_at: createdAt
    }

    const validated = DecisionRecord.parse(decision)
    if (!validated.ok) {
      return { ok: false, refusal: invalidDecisionRefusal(validated.message) }
    }

    const keyDecision: KeyDecision = {
      id: rt.ulid(),
      decision_id: validated.value.id,
      title: validated.value.title,
      scope: escapedScope,
      criterion_id: input.criterion_id
    }

    const prospective: Thread = {
      ...thread,
      spine: { ...thread.spine, key_decisions: [...thread.spine.key_decisions, keyDecision] },
      updated_at: rt.now()
    }

    const prospectiveValidated = ThreadRecord.parse(prospective)

    const linkSkippedReason = prospectiveValidated.ok
      ? null
      : `the thread record carrying this link failed its stored-shape validation, so the decision was recorded and the spine link was not written: ${prospectiveValidated.message}`

    const changes: RecordChange[] = prospectiveValidated.ok
      ? [
          { kind: 'decision', record: validated.value },
          { kind: 'thread', record: prospectiveValidated.value }
        ]
      : [{ kind: 'decision', record: validated.value }]

    const committed = store.commit(changes, `record decision ${validated.value.id} on thread ${thread.slug}`)
    if (!committed.ok) {
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    return {
      ok: true,
      text:
        linkSkippedReason === null
          ? `recorded decision ${validated.value.id} on thread ${thread.slug} and linked it into the running summary.`
          : `recorded decision ${validated.value.id} on thread ${thread.slug}; the running-summary link was not written.`,
      structured: {
        decision_id: validated.value.id,
        thread_id: thread.id,
        commit: validated.value.commit,
        scope: input.scope === undefined ? null : escapedScope,
        linked: linkSkippedReason === null,
        link_skipped_reason: linkSkippedReason
      }
    }
  }
}
