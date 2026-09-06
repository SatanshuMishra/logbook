import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import type { Criterion, Thread } from '../../schema/thread.ts'
import { SLUG_PATTERN, ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { commitThread, loadThreadForReference, openProjectStore } from '../tool-support.ts'

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
      .describe('the re-runnable check that decides whether this criterion is true, for example npm test exits 0')
  })
  .describe('one completion criterion together with the check that decides it')

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
    .describe('the id of an existing thread this new thread succeeds, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD; omit it when this thread succeeds no earlier thread'),
  completion_criteria: z
    .array(CriterionCreateSchema)
    .min(1)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .describe('what finishing looks like; at least one criterion is required or the thread can never be closed')
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
        check: z.string().describe('the stored check that decides this criterion')
      })
    )
    .describe('the criteria minted for this thread, in display order')
})

type OpenThreadInput = z.infer<typeof OpenThreadInputSchema>
type OpenThreadOutput = z.infer<typeof OpenThreadOutputSchema>

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

export const openThreadTool: ToolSpec<OpenThreadInput, OpenThreadOutput> = {
  name: 'open_thread',
  title: 'Open thread',
  description:
    'Creates a new thread of work and returns its id. A thread needs a one-line title, a short slug that is unique in this project, and at least one completion criterion stating what finishing looks like; a thread with no criterion can never be closed, so the call is refused without one. Every criterion carries its own check, the re-runnable thing that decides whether it is true, and a criterion with no check is refused. Criteria are supplied as text-and-check pairs and the server assigns each one a stable id and its display ordinal, so [{"text": "the merge test passes in both push orders", "check": "npm test exits 0"}] is a complete value. The slug is lowercase letters, digits and hyphens, up to 64 characters, for example merge-and-sync.',
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

    const escapedCriteria = input.completion_criteria.map((entry) => ({
      text: escapeStored(entry.text),
      check: escapeStored(entry.check)
    }))
    const oversizedTextIndex = escapedCriteria.findIndex((entry) => entry.text.length > caps.CRITERION_TEXT_MAX)
    if (oversizedTextIndex !== -1) {
      const oversized = escapedCriteria[oversizedTextIndex]
      return {
        ok: false,
        refusal: criterionTextCapRefusal(oversizedTextIndex, oversized === undefined ? 0 : oversized.text.length)
      }
    }
    const oversizedCheckIndex = escapedCriteria.findIndex((entry) => entry.check.length > caps.CRITERION_CHECK_MAX)
    if (oversizedCheckIndex !== -1) {
      const oversized = escapedCriteria[oversizedCheckIndex]
      return {
        ok: false,
        refusal: criterionCheckCapRefusal(oversizedCheckIndex, oversized === undefined ? 0 : oversized.check.length)
      }
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
      check: entry.check,
      result: null,
      result_status: null,
      struck_by: null
    }))

    const thread: Thread = {
      id: rt.ulid(),
      slug: input.slug,
      title: escapedTitle,
      status: 'open',
      blocked_by: null,
      ...(predecessorId === undefined ? {} : { predecessor_id: predecessorId }),
      completion_criteria: completionCriteria,
      spine: {
        active_goal: '',
        next_step: '',
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
      text: `opened thread ${committed.value.slug} (${committed.value.id}) with ${committed.value.completion_criteria.length} completion criteria.`,
      structured: {
        thread_id: committed.value.id,
        slug: committed.value.slug,
        status: committed.value.status,
        completion_criteria: committed.value.completion_criteria.map((c) => ({
          id: c.id,
          ordinal: c.ordinal,
          text: c.text,
          check: c.check ?? ''
        }))
      }
    }
  }
}
