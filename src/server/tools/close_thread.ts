import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import type { SessionEntry } from '../../schema/session.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { transition } from '../../domain/lifecycle.ts'
import { ThreadRecord, criterionSettledness, type Thread, type Settledness } from '../../schema/thread.ts'
import { openProjectStore, loadThread } from '../tool-support.ts'
import type { Refusal } from '../../schema/declare.ts'
import { withDetail } from '../../store/detail.ts'
import { layoutFor } from '../../store/layout.ts'
import { releasePointerIfOwned } from '../../domain/pointer.ts'

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
  session_entry_id: z.string().describe('the id of the session log entry that recorded the closure detail'),
  result_status_split: z
    .object({
      verified: z.number().int().describe('how many met criteria recorded a check that was actually run'),
      unverified_reasoned: z
        .number()
        .int()
        .describe('how many met criteria recorded a check that could not be run, with the reason'),
      not_recorded: z.number().int().describe('how many met criteria carry no recorded result at all')
    })
    .describe('how the met criteria on this thread divide by how their result was obtained'),
  settledness_split: z
    .object({
      confirmed: z.number().int().describe('how many met criteria the human stated or agreed to'),
      proposed: z
        .number()
        .int()
        .describe('how many met criteria were derived rather than stated, which is where a criterion stored before settledness was recorded also counts'),
      unsettled: z
        .number()
        .int()
        .describe('how many met criteria still say that done was genuinely not known for that part')
    })
    .describe(
      'how the met criteria on this thread divide by who stood behind them, and no count in this split is ever a reason to refuse the close'
    )
})

type ResultStatusSplit = { verified: number; unverified_reasoned: number; not_recorded: number }

const resultStatusSplitOf = (thread: Thread): ResultStatusSplit => {
  const met = thread.completion_criteria.filter((criterion) => criterion.struck_by === null && criterion.done)
  const verified = met.filter((criterion) => criterion.result_status === 'verified').length
  const unverifiedReasoned = met.filter((criterion) => criterion.result_status === 'unverified-reasoned').length
  return {
    verified,
    unverified_reasoned: unverifiedReasoned,
    not_recorded: met.length - verified - unverifiedReasoned
  }
}

const renderResultStatusSplit = (split: ResultStatusSplit): string =>
  `criteria met: ${split.verified} verified, ${split.unverified_reasoned} unverified-reasoned, ${split.not_recorded} not recorded`

type SettlednessSplit = { confirmed: number; proposed: number; unsettled: number }

const settlednessSplitOf = (thread: Thread): SettlednessSplit => {
  const met = thread.completion_criteria.filter((criterion) => criterion.struck_by === null && criterion.done)
  const countOf = (settledness: Settledness): number =>
    met.filter((criterion) => criterionSettledness(criterion) === settledness).length
  return { confirmed: countOf('confirmed'), proposed: countOf('proposed'), unsettled: countOf('unsettled') }
}

const renderSettlednessSplit = (split: SettlednessSplit): string =>
  `who stood behind them: ${split.confirmed} confirmed, ${split.proposed} proposed, ${split.unsettled} unsettled`

type CloseThreadInput = z.infer<typeof CloseThreadInputSchema>
type CloseThreadOutput = z.infer<typeof CloseThreadOutputSchema>

export const wholeRecordCapRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a serialised thread record that stays within the whole-record byte cap',
  example: 'strike an existing entry before retrying',
  retryable: true,
  message: `the thread record after this change failed its stored-shape validation: ${issue}`
})

export const commitFailureRefusal = (detail: string): Refusal =>
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

const sessionBodyCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'detail',
  accepted: `at most ${caps.SESSION_BODY_MAX} characters after escaping`,
  example: 'shipped the health check before closing this thread',
  retryable: true,
  message: `detail exceeds its cap of ${caps.SESSION_BODY_MAX} characters after escaping; observed ${observed}; remedy: shorten the closure detail and retry.`
})

export const closeThreadTool: ToolSpec<CloseThreadInput, CloseThreadOutput> = {
  name: 'close_thread',
  title: 'Close thread',
  description:
    'Closes one thread as either done or abandoned, and this cannot be undone through any tool. Closing as done is gated: every criterion that has not been struck must already be marked done and a closure statement must be supplied, and if any criterion is still open the call is refused and names each one. Closing as abandoned needs a reason instead, which is written to the session log rather than onto the thread. Closing also releases the record of what is being worked, but only when that record names the thread being closed. Reopening later means creating a new thread that references this one. The reply reports how the met criteria divide between checks that were run and checks that could not be, and neither count is ever a reason to refuse.',
  input: CloseThreadInputSchema,
  output: CloseThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

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

    const escapedDetail = escapeStored(input.detail)
    if (escapedDetail.length > caps.SESSION_BODY_MAX) {
      return { ok: false, refusal: sessionBodyCapRefusal(escapedDetail.length) }
    }

    const sessionEntry: SessionEntry = {
      id: rt.ulid(),
      thread_id: thread.id,
      actor: 'logbook:close_thread',
      body: escapedDetail,
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

    releasePointerIfOwned(rt, layout.value, thread.id)

    const split = resultStatusSplitOf(validated.value)
    const settledness = settlednessSplitOf(validated.value)

    return {
      ok: true,
      text: `closed thread ${thread.slug} as ${input.outcome}; ${renderResultStatusSplit(split)}; ${renderSettlednessSplit(settledness)}.`,
      structured: {
        thread_id: validated.value.id,
        status: input.outcome,
        session_entry_id: sessionEntry.id,
        result_status_split: split,
        settledness_split: settledness
      }
    }
  }
}
