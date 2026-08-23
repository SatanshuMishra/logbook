import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import type { SessionEntry } from '../../schema/session.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { transition } from '../../domain/lifecycle.ts'
import { ThreadRecord } from '../../schema/thread.ts'
import { openProjectStore, loadThread } from '../tool-support.ts'
import type { Refusal } from '../../schema/declare.ts'
import { withDetail } from '../../store/detail.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const CloseThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to close'),
  outcome: z.enum(['done', 'abandoned']).describe('close the thread as finished (done) or as no longer being pursued (abandoned)'),
  detail: z
    .string()
    .min(1)
    .max(caps.THREAD_CLOSURE_DETAIL_MAX)
    .describe('the closure statement when outcome is done, or the abandon reason when outcome is abandoned; required either way')
})

const CloseThreadOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread that was closed'),
  status: z.enum(['done', 'abandoned']).describe('the lifecycle state the thread now carries'),
  session_entry_id: z.string().describe('the id of the session log entry that recorded the closure detail')
})

type CloseThreadInput = z.infer<typeof CloseThreadInputSchema>
type CloseThreadOutput = z.infer<typeof CloseThreadOutputSchema>

const wholeRecordCapRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a serialised thread record that stays within the whole-record byte cap',
  example: 'strike an existing entry before retrying',
  retryable: true,
  message: `the thread record after this change failed its stored-shape validation: ${issue}`
})

const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'thread',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for this closure did not complete; retry the call.'
    },
    detail
  )

export const closeThreadTool: ToolSpec<CloseThreadInput, CloseThreadOutput> = {
  name: 'close_thread',
  title: 'Close thread',
  description:
    'Closes one thread as either done or abandoned, and this cannot be undone through any tool. Closing as done is gated: every criterion that has not been struck must already be marked done and a closure statement must be supplied, and if any criterion is still open the call is refused and names each one. Closing as abandoned needs a reason instead, which is written to the session log rather than onto the thread. Reopening later means creating a new thread that references this one.',
  input: CloseThreadInputSchema,
  output: CloseThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const transitioned = transition(rt, thread, input.outcome, input.detail)
    if (!transitioned.ok) {
      return { ok: false, refusal: transitioned }
    }

    const validated = ThreadRecord.parse(transitioned.value)
    if (!validated.ok) {
      return { ok: false, refusal: wholeRecordCapRefusal(validated.message) }
    }

    const sessionEntry: SessionEntry = {
      id: rt.ulid(),
      thread_id: thread.id,
      actor: 'logbook:close_thread',
      body: escapeStored(input.detail),
      created_at: rt.now()
    }

    const committed = store.commit(
      [
        { kind: 'thread', record: validated.value },
        { kind: 'session', record: sessionEntry }
      ],
      `close thread ${thread.slug} as ${input.outcome}`
    )
    if (!committed.ok) {
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    return {
      ok: true,
      text: `closed thread ${thread.slug} as ${input.outcome}.`,
      structured: {
        thread_id: validated.value.id,
        status: input.outcome,
        session_entry_id: sessionEntry.id
      }
    }
  }
}
