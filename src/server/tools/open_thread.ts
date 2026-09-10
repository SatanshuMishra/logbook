import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import type { Artifact, Criterion, Thread } from '../../schema/thread.ts'
import { criterionSettledness } from '../../schema/thread.ts'
import { SLUG_PATTERN, ULID_PATTERN } from '../../schema/ids.ts'
import { ULID_LENGTH } from '../../schema/ulid-length.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { ArtifactAddSchema, commitThread, loadThreadForReference, mintArtifacts, openProjectStore } from '../tool-support.ts'

const CriterionCreateSchema = z
  .strictObject({
    text: z
      .string()
      .min(1)
      .max(caps.CRITERION_TEXT_MAX)
      .describe('one completion criterion as plain text; the server mints its id and display ordinal'),
    check: z
      .string()
      .min(1)
      .max(caps.CRITERION_CHECK_MAX)
      .optional()
      .describe('the re-runnable check that decides whether this criterion is true, for example npm test exits 0; required unless settledness is unsettled'),
    settledness: z
      .enum(['confirmed', 'proposed', 'unsettled'])
      .describe(
        'who stands behind this criterion: confirmed when the human stated or agreed it, proposed when you derived it, unsettled when done is genuinely not known for this part yet'
      ),
    settled_by: z
      .string()
      .regex(/\S/)
      .max(caps.CRITERION_SETTLED_BY_MAX)
      .optional()
      .describe('the human words behind a confirmed criterion, quoted verbatim; refused on any other settledness')
  })
  .describe('one completion criterion together with the check that decides it and the settledness that says who stands behind it')

const OpenThreadInputSchema = z.strictObject({
  title: z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the one-line thread title'),
  slug: z
    .string()
    .min(1)
    .max(caps.THREAD_SLUG_MAX)
    .regex(SLUG_PATTERN)
    .describe('a short lowercase label unique in this project, letters digits and hyphens, for example merge-and-sync'),
  predecessor_id: z
    .string()
    .regex(ULID_PATTERN)
    .optional()
    .describe(
      `the id of an existing thread this new thread succeeds, a ${ULID_LENGTH}-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD; omit it when this thread succeeds no earlier thread`
    ),
  active_goal: z
    .string()
    .regex(/\S/)
    .max(caps.SPINE_ACTIVE_GOAL_MAX)
    .describe('what this thread is trying to achieve, in one or two sentences a fresh session can act on'),
  next_step: z
    .string()
    .regex(/\S/)
    .max(caps.SPINE_NEXT_STEP_MAX)
    .describe('the next action someone would take, naming the file and the place in it where the action involves one'),
  completion_criteria: z
    .array(CriterionCreateSchema)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('what finishing looks like where that is already known; omit it and the definition of done is owed later'),
  artifacts: z
    .array(ArtifactAddSchema)
    .max(caps.ARTIFACTS_PER_CALL_MAX_ELEMENTS)
    .optional()
    .describe('documents this thread already needs; each one is minted a stable id, exactly as artifacts_add does on update_thread')
})

const OpenThreadOutputSchema = z.object({
  thread_id: z.string().describe('the id of the newly created thread'),
  slug: z.string().describe('the slug recorded on the new thread'),
  status: z.enum(['open', 'done', 'abandoned']).describe('the lifecycle state of the new thread, always open'),
  completion_criteria: z
    .array(
      z.object({
        id: z.string().describe('the id minted for this criterion'),
        ordinal: z.number().int().describe('the display position of this criterion'),
        text: z.string().describe('the stored text of this criterion'),
        check: z
          .string()
          .nullable()
          .describe('the stored check that decides this criterion, or null when none was recorded because the criterion is unsettled'),
        settledness: z
          .enum(['confirmed', 'proposed', 'unsettled'])
          .describe('who stands behind this criterion as stored: confirmed by the human, proposed by you, or unsettled because done is not known yet')
      })
    )
    .describe('the criteria minted for this thread, in display order')
})

type OpenThreadInput = z.infer<typeof OpenThreadInputSchema>
type OpenThreadOutput = z.infer<typeof OpenThreadOutputSchema>

const RELAY_INSTRUCTION =
  'put each of these to the human as it stands, and record what they answer with criteria_settled on update_thread.'

const DEFINITION_OF_DONE_OWED = 'no completion criteria were recorded, so a definition of done is still owed.'

const criterionLine = (criterion: Criterion): string =>
  `${criterion.ordinal}. ${criterion.text} [${criterionSettledness(criterion)}]`

const openedThreadText = (thread: Thread): string => {
  const opened = `opened thread ${thread.slug} (${thread.id}).`
  if (thread.completion_criteria.length === 0) return `${opened}\n${DEFINITION_OF_DONE_OWED}`
  const stored = thread.completion_criteria.map(criterionLine).join('\n')
  return `${opened}\ncompletion criteria as stored:\n${stored}\n${RELAY_INSTRUCTION}`
}

export const duplicateSlugRefusal = (slug: string): Refusal => ({
  ok: false,
  field: 'slug',
  accepted: 'a slug not already used by another thread in this project',
  example: 'merge-and-sync-2',
  retryable: true,
  message: `slug "${slug}" is already used by another thread in this project.`
})

const titleCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'title',
  accepted: `at most ${caps.THREAD_TITLE_MAX} characters after escaping`,
  example: 'ship the health check before closing this thread',
  retryable: true,
  message: `title exceeds its cap of ${caps.THREAD_TITLE_MAX} characters after escaping; observed ${observed}; remedy: shorten the title and retry.`
})

const activeGoalCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'active_goal',
  accepted: `at most ${caps.SPINE_ACTIVE_GOAL_MAX} characters after escaping`,
  example: 'ship the health check before closing this thread',
  retryable: true,
  message: `active_goal exceeds its cap of ${caps.SPINE_ACTIVE_GOAL_MAX} characters after escaping; observed ${observed}; remedy: shorten the value and retry.`
})

const nextStepCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'next_step',
  accepted: `at most ${caps.SPINE_NEXT_STEP_MAX} characters after escaping`,
  example: 'ship the health check before closing this thread',
  retryable: true,
  message: `next_step exceeds its cap of ${caps.SPINE_NEXT_STEP_MAX} characters after escaping; observed ${observed}; remedy: shorten the value and retry.`
})

const criterionTextCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: `at most ${caps.CRITERION_TEXT_MAX} characters after escaping, per criterion`,
  example: 'ship the health check before closing this thread',
  retryable: true,
  message: `completion_criteria[${index}] exceeds its cap of ${caps.CRITERION_TEXT_MAX} characters after escaping; observed ${observed}; remedy: shorten the criterion text and retry.`
})

const criterionCheckCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: `at most ${caps.CRITERION_CHECK_MAX} characters after escaping, per check`,
  example: 'npm test exits 0',
  retryable: true,
  message: `completion_criteria[${index}].check exceeds its cap of ${caps.CRITERION_CHECK_MAX} characters after escaping; observed ${observed}; remedy: shorten the check and retry.`
})

const criterionSettledByCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: `at most ${caps.CRITERION_SETTLED_BY_MAX} characters after escaping, per settled_by`,
  example: 'it has to block before the turn ends',
  retryable: true,
  message: `completion_criteria[${index}].settled_by exceeds its cap of ${caps.CRITERION_SETTLED_BY_MAX} characters after escaping; observed ${observed}; remedy: shorten the quote and retry.`
})

const checkOwedRefusal = (index: number, settledness: string): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: 'a check on every confirmed or proposed criterion',
  example: 'npm test exits 0',
  retryable: true,
  message: `completion_criteria[${index}] is ${settledness} and carries no check; a criterion that asserts something needs something to decide it; remedy: add a check, or record it as unsettled if done is not known for this part yet.`
})

const quoteOwedRefusal = (index: number): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: 'the human words behind a confirmed criterion, quoted verbatim',
  example: 'it has to block before the turn ends',
  retryable: true,
  message: `completion_criteria[${index}] is confirmed and carries no settled_by; remedy: quote what the human said, or record it as proposed.`
})

const quoteNotOwedRefusal = (index: number, settledness: string): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: 'settled_by only on a confirmed criterion',
  example: 'omit settled_by',
  retryable: true,
  message: `completion_criteria[${index}] is ${settledness} and carries a settled_by quote; remedy: drop the quote, or record the criterion as confirmed if the human really said it.`
})

export const openThreadTool: ToolSpec<OpenThreadInput, OpenThreadOutput> = {
  name: 'open_thread',
  title: 'Open thread',
  description:
    `Creates a new thread of work and returns its id. A thread needs a one-line title, a short slug that is unique in this project, what the work is, and what happens next. Completion criteria are optional at this moment; when supplied, every criterion records who stands behind it: confirmed when the human said so, proposed when derived, or unsettled when done is not yet known. A confirmed or proposed criterion also carries its own check, the re-runnable thing that decides whether it is true, and a criterion missing what its settledness requires is refused. A confirmed criterion also carries settled_by, the human's own words quoted verbatim, and a settled_by given on any other settledness is refused. Criteria are supplied as objects and the server assigns each one a stable id and its display ordinal, so [{"text": "the merge test passes in both push orders", "check": "npm test exits 0", "settledness": "proposed"}] is a complete value. The slug is lowercase letters, digits and hyphens, up to ${caps.THREAD_SLUG_MAX} characters, for example merge-and-sync.`,
  input: OpenThreadInputSchema,
  output: OpenThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const collision = store.readThreads().find((slot) => !slot.quarantined && slot.record.slug === input.slug)
    if (collision !== undefined) {
      return { ok: false, refusal: duplicateSlugRefusal(input.slug) }
    }

    const escapedTitle = escapeStored(input.title)
    if (escapedTitle.length > caps.THREAD_TITLE_MAX) {
      return { ok: false, refusal: titleCapRefusal(escapedTitle.length) }
    }

    const escapedActiveGoal = escapeStored(input.active_goal)
    if (escapedActiveGoal.length > caps.SPINE_ACTIVE_GOAL_MAX) {
      return { ok: false, refusal: activeGoalCapRefusal(escapedActiveGoal.length) }
    }

    const escapedNextStep = escapeStored(input.next_step)
    if (escapedNextStep.length > caps.SPINE_NEXT_STEP_MAX) {
      return { ok: false, refusal: nextStepCapRefusal(escapedNextStep.length) }
    }

    const criteria = input.completion_criteria ?? []
    const escapedCriteria = criteria.map((entry) => ({
      text: escapeStored(entry.text),
      check: entry.check === undefined ? undefined : escapeStored(entry.check),
      settledness: entry.settledness,
      settled_by: entry.settled_by === undefined ? undefined : escapeStored(entry.settled_by)
    }))
    const oversizedTextIndex = escapedCriteria.findIndex((entry) => entry.text.length > caps.CRITERION_TEXT_MAX)
    if (oversizedTextIndex !== -1) {
      const oversized = escapedCriteria[oversizedTextIndex]
      return {
        ok: false,
        refusal: criterionTextCapRefusal(oversizedTextIndex, oversized === undefined ? 0 : oversized.text.length)
      }
    }
    const oversizedCheckIndex = escapedCriteria.findIndex(
      (entry) => entry.check !== undefined && entry.check.length > caps.CRITERION_CHECK_MAX
    )
    if (oversizedCheckIndex !== -1) {
      const oversized = escapedCriteria[oversizedCheckIndex]
      return {
        ok: false,
        refusal: criterionCheckCapRefusal(oversizedCheckIndex, oversized === undefined ? 0 : (oversized.check?.length ?? 0))
      }
    }
    const oversizedSettledByIndex = escapedCriteria.findIndex(
      (entry) => entry.settled_by !== undefined && entry.settled_by.length > caps.CRITERION_SETTLED_BY_MAX
    )
    if (oversizedSettledByIndex !== -1) {
      const oversized = escapedCriteria[oversizedSettledByIndex]
      return {
        ok: false,
        refusal: criterionSettledByCapRefusal(oversizedSettledByIndex, oversized === undefined ? 0 : (oversized.settled_by?.length ?? 0))
      }
    }
    const checkOwedIndex = escapedCriteria.findIndex((entry) => entry.settledness !== 'unsettled' && entry.check === undefined)
    if (checkOwedIndex !== -1) {
      const entry = escapedCriteria[checkOwedIndex]
      return { ok: false, refusal: checkOwedRefusal(checkOwedIndex, entry === undefined ? '' : entry.settledness) }
    }
    const quoteOwedIndex = escapedCriteria.findIndex(
      (entry) => entry.settledness === 'confirmed' && (entry.settled_by === undefined || entry.settled_by.length === 0)
    )
    if (quoteOwedIndex !== -1) {
      return { ok: false, refusal: quoteOwedRefusal(quoteOwedIndex) }
    }
    const quoteNotOwedIndex = escapedCriteria.findIndex(
      (entry) => entry.settledness !== 'confirmed' && entry.settled_by !== undefined
    )
    if (quoteNotOwedIndex !== -1) {
      const entry = escapedCriteria[quoteNotOwedIndex]
      return { ok: false, refusal: quoteNotOwedRefusal(quoteNotOwedIndex, entry === undefined ? '' : entry.settledness) }
    }

    const predecessorId = input.predecessor_id
    if (predecessorId !== undefined) {
      const predecessor = loadThreadForReference(store, 'predecessor_id', predecessorId)
      if (!predecessor.ok) return { ok: false, refusal: predecessor.refusal }
    }

    const now = rt.now()
    const completionCriteria: Criterion[] = escapedCriteria.map((entry, index) => ({
      id: rt.ulid(),
      ordinal: index + 1,
      text: entry.text,
      done: false,
      kind: 'planned',
      check: entry.check ?? null,
      result: null,
      result_status: null,
      struck_by: null,
      settledness: entry.settledness,
      settled_by: entry.settled_by ?? null
    }))

    const mintedArtifacts: Artifact[] = mintArtifacts(rt, input.artifacts ?? [])

    const thread: Thread = {
      id: rt.ulid(),
      slug: input.slug,
      title: escapedTitle,
      status: 'open',
      blocked_by: null,
      ...(predecessorId === undefined ? {} : { predecessor_id: predecessorId }),
      completion_criteria: completionCriteria,
      ...(mintedArtifacts.length === 0 ? {} : { artifacts: mintedArtifacts }),
      spine: {
        active_goal: escapedActiveGoal,
        next_step: escapedNextStep,
        landed: '',
        last_session: '',
        open_risks: [],
        key_decisions: [],
        out_of_scope: []
      },
      created_at: now,
      updated_at: now
    }

    const committed = commitThread(store, thread, `open thread ${thread.slug}`)
    if (!committed.ok) return { ok: false, refusal: committed.refusal }

    return {
      ok: true,
      text: openedThreadText(committed.value),
      structured: {
        thread_id: committed.value.id,
        slug: committed.value.slug,
        status: committed.value.status,
        completion_criteria: committed.value.completion_criteria.map((c) => ({
          id: c.id,
          ordinal: c.ordinal,
          text: c.text,
          check: c.check ?? null,
          settledness: criterionSettledness(c)
        }))
      }
    }
  }
}
