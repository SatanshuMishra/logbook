import { z } from 'zod'
import type { ToolSpec, ToolReply } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import type { SessionEntry } from '../../schema/session.ts'
import { ThreadRecord, type Thread } from '../../schema/thread.ts'
import type { Store } from '../../store/records.ts'
import type { StoreLayout } from '../../store/layout.ts'
import { layoutFor } from '../../store/layout.ts'
import { readPointer, releasePointer, releasePointerIfOwned } from '../../domain/pointer.ts'
import { withDetail } from '../../store/detail.ts'
import { contributeToSpine, type SpineContribution } from '../../domain/spine.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import { openProjectStore } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const ParkThreadInputSchema = z.strictObject({
  outcome: z
    .string()
    .min(1)
    .max(caps.SESSION_BODY_MAX)
    .describe('what happened in this session, written to the session log as-is'),
  thread_id: ulidField(
    'the id of the thread being worked; omit it and the machine resolves it from what is currently marked as being worked'
  ).optional(),
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  next_step: z
    .string()
    .max(caps.SPINE_NEXT_STEP_MAX)
    .optional()
    .describe('replaces the spine next_step field when supplied; omit to leave it unchanged')
})

const ParkThreadOutputSchema = z.object({
  status: z
    .enum([
      'parked',
      'not-the-worked-thread',
      'nothing-to-park',
      'stale-pointer-released',
      'terminal-pointer-released'
    ])
    .describe('what this call actually did'),
  parked_thread_ids: z
    .array(z.string())
    .describe('the id of the thread that was parked by this call, empty when nothing was parked'),
  session_entry_ids: z
    .array(z.string())
    .describe('the id of the session log entry this call wrote, empty when none was written'),
  spine_fields_updated: z
    .array(z.enum(['last_session', 'next_step']))
    .describe('which spine fields this call changed'),
  pointer_released: z
    .boolean()
    .describe('whether the record of what is being worked was released by this call')
})

type ParkThreadInput = z.infer<typeof ParkThreadInputSchema>
type ParkThreadOutput = z.infer<typeof ParkThreadOutputSchema>

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
      message: 'the ledger commit for this park did not complete; retry the call.'
    },
    detail
  )

const sessionBodyCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: `at most ${caps.SESSION_BODY_MAX} characters after escaping`,
  example: 'shipped the health check and left the merge order test for next session',
  retryable: true,
  message: `outcome exceeds its cap of ${caps.SESSION_BODY_MAX} characters after escaping; observed ${observed}; remedy: shorten the outcome and retry.`
})

const quarantinedPointerRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'a thread record that parses cleanly',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `the thread currently marked as being worked (${threadId}) has a stored record that failed to parse and was quarantined.`
})

const emptyStatusReply = (status: 'not-the-worked-thread' | 'nothing-to-park'): ToolReply<ParkThreadOutput> => ({
  ok: true,
  text:
    status === 'nothing-to-park'
      ? 'no thread is currently marked as being worked; nothing to park.'
      : 'the given thread is not the one currently marked as being worked; nothing changed.',
  structured: {
    status,
    parked_thread_ids: [],
    session_entry_ids: [],
    spine_fields_updated: [],
    pointer_released: false
  }
})

const releasedStatusReply = (
  status: 'stale-pointer-released' | 'terminal-pointer-released',
  text: string,
  pointerReleased: boolean
): ToolReply<ParkThreadOutput> => ({
  ok: true,
  text,
  structured: {
    status,
    parked_thread_ids: [],
    session_entry_ids: [],
    spine_fields_updated: [],
    pointer_released: pointerReleased
  }
})

const parkResolvedThread = (
  rt: Runtime,
  store: Store,
  layout: StoreLayout,
  threadId: string,
  input: ParkThreadInput
): ToolReply<ParkThreadOutput> => {
  const slot = store.readThread(threadId)

  if (slot === null) {
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'stale-pointer-released',
      'the thread marked as being worked no longer has a record; the stale pointer was released.',
      released === 'released'
    )
  }

  if (slot.quarantined) {
    return { ok: false, refusal: quarantinedPointerRefusal(threadId) }
  }

  const thread = slot.record

  if (thread.status !== 'open') {
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'terminal-pointer-released',
      `the thread marked as being worked is already ${thread.status}, which is terminal; the pointer was released.`,
      released === 'released'
    )
  }

  const escapedOutcome = escapeStored(input.outcome)
  if (escapedOutcome.length > caps.SESSION_BODY_MAX) {
    return { ok: false, refusal: sessionBodyCapRefusal(escapedOutcome.length) }
  }

  const spineContribution: SpineContribution = {
    ...(input.last_session !== undefined ? { last_session: input.last_session } : {}),
    ...(input.next_step !== undefined ? { next_step: input.next_step } : {})
  }
  const spineFieldsUpdated: ('last_session' | 'next_step')[] = [
    ...(input.last_session !== undefined ? (['last_session'] as const) : []),
    ...(input.next_step !== undefined ? (['next_step'] as const) : [])
  ]

  const contributed = contributeToSpine(thread.spine, spineContribution)
  if (!contributed.ok) {
    return { ok: false, refusal: contributed }
  }

  const nextThread: Thread = {
    ...thread,
    spine: contributed.value,
    updated_at: rt.now()
  }

  const validated = ThreadRecord.parse(nextThread)
  if (!validated.ok) {
    return { ok: false, refusal: wholeRecordCapRefusal(validated.message) }
  }

  const sessionEntry: SessionEntry = {
    id: rt.ulid(),
    thread_id: thread.id,
    actor: 'logbook:park_thread',
    body: escapedOutcome,
    created_at: rt.now()
  }

  const committed = store.commit(
    [
      { kind: 'thread', record: validated.value },
      { kind: 'session', record: sessionEntry }
    ],
    `park thread ${thread.slug}`
  )
  if (!committed.ok) {
    return { ok: false, refusal: commitFailureRefusal(committed.detail) }
  }

  const released = releasePointerIfOwned(rt, layout, thread.id)

  return {
    ok: true,
    text: `parked thread ${thread.slug}.`,
    structured: {
      status: 'parked',
      parked_thread_ids: [thread.id],
      session_entry_ids: [sessionEntry.id],
      spine_fields_updated: spineFieldsUpdated,
      pointer_released: released === 'released'
    }
  }
}

export const parkThreadTool: ToolSpec<ParkThreadInput, ParkThreadOutput> = {
  name: 'park_thread',
  title: 'Park thread',
  description:
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the six running-summary fields, and releases the record of what is being worked. Takes the outcome as text plus whichever summary fields changed; the thread id is optional because the machine already knows which thread is being worked. Parking a thread that is already parked is not an error. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
  input: ParkThreadInputSchema,
  output: ParkThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const pointerRead = readPointer(rt, layout.value)

    if (pointerRead.kind === 'corrupt') {
      releasePointer(rt, layout.value)
      return releasedStatusReply(
        'stale-pointer-released',
        'the record of what is being worked failed to parse; the stale pointer was released.',
        true
      )
    }

    if (pointerRead.kind === 'absent') return emptyStatusReply('nothing-to-park')

    const pointer = pointerRead.value

    if (input.thread_id !== undefined) {
      if (pointer.thread_id !== input.thread_id) return emptyStatusReply('not-the-worked-thread')
      return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
    }

    if (pointer.session_id !== rt.sessionId) return emptyStatusReply('not-the-worked-thread')
    return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
  }
}
