import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { insertCriterion, rewriteCriterion, strikeCriterion } from '../../domain/criteria.ts'
import { commitThread, decisionResolver, loadThread, openProjectStore } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const AmendCriteriaInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread carrying the criterion to amend'),
  operation: z.enum(['insert', 'rewrite', 'strike']).describe('which of the three amendment kinds to apply'),
  decision_id: ulidField(
    'the decision record that resolves and justifies this amendment; must already be recorded on this project'
  ),
  criterion_id: ulidField('the id of the criterion to rewrite or strike; required for rewrite and strike, ignored for insert')
    .optional(),
  text: z
    .string()
    .min(1)
    .max(caps.CRITERION_TEXT_MAX)
    .optional()
    .describe('the criterion text for insert or rewrite; required for those two, ignored for strike'),
  kind: z
    .enum(['planned', 'detour'])
    .optional()
    .describe('whether an inserted criterion was planned up front or added mid-thread; required for insert, ignored otherwise'),
  check: z
    .string()
    .min(1)
    .max(caps.CRITERION_CHECK_MAX)
    .optional()
    .describe(
      'the re-runnable check that decides whether a criterion is true; required for insert unless settledness is unsettled; on a rewrite it is optional and writes the criterion\'s check, and omitting it leaves the existing check unchanged; ignored on strike'
    ),
  settledness: z
    .enum(['confirmed', 'proposed', 'unsettled'])
    .optional()
    .describe(
      'who stands behind an inserted criterion: confirmed when the human stated or agreed it, proposed when you derived it, unsettled when done is genuinely not known for this part yet; required for insert, and refused on rewrite and strike because neither writes it'
    ),
  settled_by: z
    .string()
    .regex(/\S/)
    .optional()
    .describe(
      'the human words behind a confirmed inserted criterion, quoted verbatim; required when settledness is confirmed, refused on any other settledness, and refused on rewrite and strike because neither writes it'
    ),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('the zero-based index an inserted criterion should occupy; omit to append at the end, ignored for rewrite and strike')
})

const AmendCriteriaOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread that was amended'),
  operation: z.enum(['insert', 'rewrite', 'strike']).describe('which amendment kind was applied'),
  criterion_id: z.string().describe('the id of the criterion that was inserted, rewritten, or struck')
})

type AmendCriteriaInput = z.infer<typeof AmendCriteriaInputSchema>
type AmendCriteriaOutput = z.infer<typeof AmendCriteriaOutputSchema>

export const missingFieldRefusal = (field: string, forOperation: string): Refusal => ({
  ok: false,
  field,
  accepted: `a value for ${field} when operation is "${forOperation}"`,
  example:
    field === 'position'
      ? '0'
      : field === 'kind'
        ? 'planned'
        : field === 'check'
          ? 'npm test exits 0'
          : 'ship the health check before closing this thread',
  retryable: true,
  message: `${field} is required when operation is "${forOperation}".`
})

const checkOwedRefusal = (settledness: string): Refusal => ({
  ok: false,
  field: 'check',
  accepted: 'a check on every confirmed or proposed criterion',
  example: 'npm test exits 0',
  retryable: true,
  message: `check is required when operation is "insert" and settledness is "${settledness}"; a criterion that asserts something needs something to decide it; remedy: add a check, or record it as unsettled if done is not known for this part yet.`
})

const quoteOwedRefusal = (): Refusal => ({
  ok: false,
  field: 'settled_by',
  accepted: 'the human words behind a confirmed criterion, quoted verbatim',
  example: 'it has to block before the turn ends',
  retryable: true,
  message: 'settled_by is required when operation is "insert" and settledness is "confirmed"; remedy: quote what the human said, or record it as proposed.'
})

const quoteNotOwedRefusal = (settledness: string): Refusal => ({
  ok: false,
  field: 'settled_by',
  accepted: 'settled_by only on a confirmed criterion',
  example: 'omit settled_by',
  retryable: true,
  message: `settled_by is refused when settledness is "${settledness}"; remedy: drop the quote, or record the criterion as confirmed if the human really said it.`
})

const settlednessNotAmendableRefusal = (field: string, forOperation: string): Refusal => ({
  ok: false,
  field,
  accepted: `${field} only on an insert`,
  example: `omit ${field}`,
  retryable: true,
  message: `${field} is refused when operation is "${forOperation}"; settledness is not a text edit and no amendment writes it, so accepting it here would drop it silently; remedy: drop ${field}, and record the human answer with criteria_settled on update_thread instead.`
})

export const amendCriteriaTool: ToolSpec<AmendCriteriaInput, AmendCriteriaOutput> = {
  name: 'amend_criteria',
  title: 'Amend criteria',
  description:
    'Amends one completion criterion on a thread by inserting a new one, rewriting the text of an existing one, or striking it, and no other kind of edit reaches a criterion once it exists. Every amendment carries a decision_id that must resolve to a decision record already stored on this project; an id that resolves to nothing is refused. Striking a criterion keeps it on the thread marked struck rather than deleting it, so a struck criterion still renders in the history it came from. An inserted criterion records who stands behind it: confirmed when the human said so, proposed when derived, or unsettled when done is not yet known. A confirmed or proposed insert also carries a check, the re-runnable thing that decides whether it is true, and an insert missing what its settledness requires is refused. A confirmed insert also carries settled_by, the human\'s own words quoted verbatim, and a settled_by given on any other settledness is refused. Insert also takes an optional zero-based position: {"operation": "insert", "text": "the merge test passes in both push orders", "check": "npm test exits 0", "settledness": "proposed", "kind": "detour", "decision_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "position": 0} inserts a criterion at the very front of the list, and omitting position appends it at the end instead.',
  input: AmendCriteriaInputSchema,
  output: AmendCriteriaOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const resolveDecision = decisionResolver(store)

    if (input.operation === 'insert') {
      if (input.text === undefined) return { ok: false, refusal: missingFieldRefusal('text', 'insert') }
      if (input.kind === undefined) return { ok: false, refusal: missingFieldRefusal('kind', 'insert') }
      if (input.settledness === undefined) return { ok: false, refusal: missingFieldRefusal('settledness', 'insert') }
      if (input.settledness !== 'unsettled' && input.check === undefined) {
        return { ok: false, refusal: checkOwedRefusal(input.settledness) }
      }
      if (input.settledness === 'confirmed' && (input.settled_by === undefined || input.settled_by.length === 0)) {
        return { ok: false, refusal: quoteOwedRefusal() }
      }
      if (input.settledness !== 'confirmed' && input.settled_by !== undefined) {
        return { ok: false, refusal: quoteNotOwedRefusal(input.settledness) }
      }

      const result = insertCriterion(
        rt,
        thread,
        {
          text: input.text,
          check: input.check,
          kind: input.kind,
          decisionId: input.decision_id,
          settledness: input.settledness,
          settledBy: input.settled_by,
          ...(input.position !== undefined ? { position: input.position } : {})
        },
        resolveDecision
      )
      if (!result.ok) return { ok: false, refusal: result }

      const priorIds = new Set(thread.completion_criteria.map((c) => c.id))
      const inserted = result.value.completion_criteria.find((c) => !priorIds.has(c.id))
      if (inserted === undefined) {
        throw new Error('amend_criteria: insertCriterion reported success but no new criterion id could be found')
      }

      const committed = commitThread(store, result.value, `insert criterion on thread ${thread.slug}`)
      if (!committed.ok) return { ok: false, refusal: committed.refusal }

      return {
        ok: true,
        text: `inserted criterion ${inserted.id} on thread ${thread.slug}.`,
        structured: { thread_id: committed.value.id, operation: 'insert', criterion_id: inserted.id }
      }
    }

    if (input.operation === 'rewrite') {
      if (input.settledness !== undefined) {
        return { ok: false, refusal: settlednessNotAmendableRefusal('settledness', 'rewrite') }
      }
      if (input.settled_by !== undefined) {
        return { ok: false, refusal: settlednessNotAmendableRefusal('settled_by', 'rewrite') }
      }
      if (input.criterion_id === undefined) return { ok: false, refusal: missingFieldRefusal('criterion_id', 'rewrite') }
      if (input.text === undefined) return { ok: false, refusal: missingFieldRefusal('text', 'rewrite') }

      const result = rewriteCriterion(
        rt,
        thread,
        { criterionId: input.criterion_id, text: input.text, decisionId: input.decision_id, check: input.check },
        resolveDecision
      )
      if (!result.ok) return { ok: false, refusal: result }

      const committed = commitThread(store, result.value, `rewrite criterion on thread ${thread.slug}`)
      if (!committed.ok) return { ok: false, refusal: committed.refusal }

      return {
        ok: true,
        text: `rewrote criterion ${input.criterion_id} on thread ${thread.slug}.`,
        structured: { thread_id: committed.value.id, operation: 'rewrite', criterion_id: input.criterion_id }
      }
    }

    if (input.settledness !== undefined) {
      return { ok: false, refusal: settlednessNotAmendableRefusal('settledness', 'strike') }
    }
    if (input.settled_by !== undefined) {
      return { ok: false, refusal: settlednessNotAmendableRefusal('settled_by', 'strike') }
    }
    if (input.criterion_id === undefined) return { ok: false, refusal: missingFieldRefusal('criterion_id', 'strike') }

    const result = strikeCriterion(
      rt,
      thread,
      { criterionId: input.criterion_id, decisionId: input.decision_id },
      resolveDecision
    )
    if (!result.ok) return { ok: false, refusal: result }

    const committed = commitThread(store, result.value, `strike criterion on thread ${thread.slug}`)
    if (!committed.ok) return { ok: false, refusal: committed.refusal }

    return {
      ok: true,
      text: `struck criterion ${input.criterion_id} on thread ${thread.slug}.`,
      structured: { thread_id: committed.value.id, operation: 'strike', criterion_id: input.criterion_id }
    }
  }
}
