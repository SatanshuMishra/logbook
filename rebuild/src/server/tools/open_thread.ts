import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import type { Criterion, Thread } from '../../schema/thread.ts'
import { SLUG_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { commitThread, openProjectStore } from '../tool-support.ts'

const OpenThreadInputSchema = z.strictObject({
  title: z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the one-line thread title'),
  slug: z
    .string()
    .min(1)
    .max(caps.THREAD_SLUG_MAX)
    .regex(SLUG_PATTERN)
    .describe('a short lowercase label unique in this project, letters digits and hyphens, for example merge-and-sync'),
  completion_criteria: z
    .array(
      z
        .string()
        .min(1)
        .max(caps.CRITERION_TEXT_MAX)
        .describe('one completion criterion as plain text; the server mints its id and display ordinal')
    )
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
        text: z.string().describe('the stored text of this criterion')
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

export const openThreadTool: ToolSpec<OpenThreadInput, OpenThreadOutput> = {
  name: 'open_thread',
  title: 'Open thread',
  description:
    'Creates a new thread of work and returns its id. A thread needs a one-line title, a short slug that is unique in this project, and at least one completion criterion stating what finishing looks like; a thread with no criterion can never be closed, so the call is refused without one. Criteria are supplied as plain strings and the server assigns each one a stable id and its display ordinal, so ["the merge test passes in both push orders", "the plan is committed"] is a complete value. The slug is lowercase letters, digits and hyphens, up to 64 characters, for example merge-and-sync.',
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

    const now = rt.now()
    const completionCriteria: Criterion[] = input.completion_criteria.map((text, index) => ({
      id: rt.ulid(),
      ordinal: index + 1,
      text: escapeStored(text),
      done: false,
      kind: 'planned',
      struck_by: null
    }))

    const thread: Thread = {
      id: rt.ulid(),
      slug: input.slug,
      title: escapeStored(input.title),
      status: 'open',
      blocked_by: null,
      completion_criteria: completionCriteria,
      spine: {
        active_goal: '',
        next_step: '',
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
        completion_criteria: committed.value.completion_criteria.map((c) => ({ id: c.id, ordinal: c.ordinal, text: c.text }))
      }
    }
  }
}
