import { z } from 'zod'
import type { ToolSpec, ToolReply } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import type { SessionEntry } from '../../schema/session.ts'
import { PARK_THREAD_ACTOR } from '../../domain/session-log.ts'
import { ThreadRecord, type Thread } from '../../schema/thread.ts'
import type { Store } from '../../store/records.ts'
import type { RecordChange } from '../../store/write-path.ts'
import type { StoreLayout } from '../../store/layout.ts'
import { layoutFor } from '../../store/layout.ts'
import { readPointer, releasePointer, releasePointerIfOwned } from '../../domain/pointer.ts'
import { withDetail } from '../../store/detail.ts'
import {
  NEXT_STEP_RECORDS_DESCRIPTION,
  NEXT_STEP_RECORD_ID_DESCRIPTION,
  STEP_RECORDS_OUTPUT_DESCRIPTION,
  checkStepRecords,
  contributeToSpine,
  renderStepRecords,
  type SpineContribution,
  type StepRecords
} from '../../domain/spine.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import { openProjectStore } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const ParkThreadInputSchema = z.strictObject({
  outcome: z
    .string()
    .min(1)
    .max(caps.SESSION_BODY_MAX)
    .optional()
    .describe(
      'anything about this session that the session log does not already hold, written to the session log as-is; omit it and the thread is still parked and the closing session log entry is still written, just carrying no outcome text'
    ),
  thread_id: ulidField(
    'the id of the thread being worked; omit it and the machine resolves it from what is currently marked as being worked'
  ).optional(),
  next_step: z
    .string()
    .optional()
    .describe('replaces the spine next_step field when supplied, stated as one decision about what to do next; omit to leave it unchanged'),
  next_step_records: z
    .array(ulidField(NEXT_STEP_RECORD_ID_DESCRIPTION))
    .optional()
    .describe(NEXT_STEP_RECORDS_DESCRIPTION)
})

const ParkThreadOutputSchema = z.object({
  status: z
    .enum([
      'parked',
      'not-the-worked-thread',
      'nothing-to-park',
      'stale-pointer-released',
      'terminal-pointer-released',
      'quarantined-pointer-released'
    ])
    .describe('what this call actually did'),
  parked_thread_ids: z
    .array(z.string())
    .describe('the id of the thread that was parked by this call, empty when nothing was parked'),
  session_entry_ids: z
    .array(z.string())
    .describe('the id of the session log entry this call wrote, empty when none was written'),
  spine_fields_updated: z
    .array(z.enum(['next_step']))
    .describe('which spine fields this call changed'),
  pointer_released: z
    .boolean()
    .describe('whether the record of what is being worked was released by this call'),
  step_records: z.string().optional().describe(STEP_RECORDS_OUTPUT_DESCRIPTION)
})

type ParkThreadInput = z.infer<typeof ParkThreadInputSchema>
type ParkThreadOutput = z.infer<typeof ParkThreadOutputSchema>

const invalidThreadRecordRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a thread record that matches its stored shape',
  example: 'correct the value named in the message and retry',
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

type Carried = Pick<ParkThreadInput, 'outcome' | 'next_step' | 'next_step_records'>

const carriesSomethingToStore = (input: Carried): boolean =>
  input.outcome !== undefined || input.next_step !== undefined || input.next_step_records !== undefined

const carriedNames = (input: Carried): string[] => [
  ...(input.outcome !== undefined ? ['the outcome'] : []),
  ...(input.next_step !== undefined ? ['the next step'] : []),
  ...(input.next_step_records !== undefined
    ? [input.next_step !== undefined ? 'its records list' : 'the records list']
    : [])
]

const listedNames = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

const notStored = (input: Carried): string => {
  const names = carriedNames(input)
  return `${listedNames(names)} ${names.length === 1 ? 'was' : 'were'} NOT stored and must be re-sent`
}

const RELEASE_ONLY_CALL = 'call park_thread with none of outcome, next_step and next_step_records'

const noWorkedThreadRefusal = (input: Carried): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied while some thread is marked as being worked',
  example: 'call resume_thread first, then send this same outcome to park_thread',
  retryable: true,
  message: `no thread is currently marked as being worked, so nothing this call carries has anywhere to be written; ${notStored(input)}; remedy: call resume_thread on the thread this session worked and then call park_thread again, re-sending what was not stored, or ${RELEASE_ONLY_CALL} to confirm there is nothing to park.`
})

const notTheWorkedThreadRefusal = (input: Carried, pointerThreadId: string, suppliedThreadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied together with the thread that is actually marked as being worked',
  example: 'send the same outcome with thread_id set to the thread this message names',
  retryable: true,
  message: `thread_id ${suppliedThreadId} is not the thread currently marked as being worked (${pointerThreadId}), so nothing this call carries has anywhere to be written; ${notStored(input)}; the pointer was left untouched; remedy: call park_thread again with thread_id ${pointerThreadId}, re-sending what was not stored.`
})

const otherSessionRefusal = (input: Carried, pointerThreadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied by the session that holds the record of what is being worked',
  example: 'call resume_thread in this session, then send this same outcome to park_thread',
  retryable: true,
  message: `the record of what is being worked names thread ${pointerThreadId} and belongs to a different session, so nothing this call carries has anywhere to be written; ${notStored(input)}; the pointer was left untouched; remedy: call resume_thread in this session and then call park_thread again, re-sending what was not stored.`
})

const missingThreadRecordRefusal = (input: Carried, threadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied for a thread whose stored record still exists',
  example: 'call park_thread with outcome omitted to release the stale pointer, then record this text elsewhere',
  retryable: false,
  message: `the thread marked as being worked (${threadId}) no longer has a stored record, so nothing this call carries has anywhere to be written; ${notStored(input)}; the pointer was left in place so this call can be retried; remedy: ${RELEASE_ONLY_CALL} to release the stale pointer, then record what was not stored on a thread that still exists.`
})

const terminalThreadRefusal = (input: Carried, threadId: string, status: Thread['status']): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied for a thread that is still open',
  example: 'call park_thread with outcome omitted to release the pointer, then record this text on a new thread',
  retryable: false,
  message: `the thread marked as being worked (${threadId}) is already ${status}, which is terminal, so nothing this call carries can be written to it; ${notStored(input)}; the pointer was left in place so this call can be retried; remedy: ${RELEASE_ONLY_CALL} to release the pointer, then open a new thread that references this one and record what was not stored there.`
})

const corruptPointerRefusal = (input: Carried): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied while the record of what is being worked parses cleanly',
  example: 'call park_thread with outcome omitted to release the unreadable pointer, then resume the thread again',
  retryable: true,
  message: `the record of what is being worked does not parse, so the thread this call belongs to cannot be resolved; ${notStored(input)}; the unreadable pointer was left in place so this call can be retried; remedy: ${RELEASE_ONLY_CALL} to release it, call resume_thread on the intended thread, then call park_thread again, re-sending what was not stored.`
})

const quarantinedPointerRefusal = (input: Carried, threadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied for a thread whose stored record parses cleanly',
  example: 'call park_thread with outcome omitted to release the pointer, then record this text elsewhere',
  retryable: false,
  message: `the thread currently marked as being worked (${threadId}) has a stored record that failed to parse and was quarantined, so nothing this call carries can be written to it; ${notStored(input)}; the pointer was left in place so this call can be retried; remedy: ${RELEASE_ONLY_CALL} to release the pointer, then record what was not stored on a thread whose record parses.`
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
  status: 'stale-pointer-released' | 'terminal-pointer-released' | 'quarantined-pointer-released',
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
  input: ParkThreadInput,
  stepRecords: StepRecords | null
): ToolReply<ParkThreadOutput> => {
  const slot = store.readThread(threadId)

  if (slot === null) {
    if (carriesSomethingToStore(input)) {
      return { ok: false, refusal: missingThreadRecordRefusal(input, threadId) }
    }
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'stale-pointer-released',
      'the thread marked as being worked no longer has a record; the stale pointer was released.',
      released === 'released'
    )
  }

  if (slot.quarantined) {
    if (carriesSomethingToStore(input)) {
      return { ok: false, refusal: quarantinedPointerRefusal(input, threadId) }
    }
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'quarantined-pointer-released',
      'the thread marked as being worked has a stored record that failed to parse; the pointer was released so another thread can be resumed.',
      released === 'released'
    )
  }

  const thread = slot.record

  if (thread.status !== 'open') {
    if (carriesSomethingToStore(input)) {
      return { ok: false, refusal: terminalThreadRefusal(input, threadId, thread.status) }
    }
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'terminal-pointer-released',
      `the thread marked as being worked is already ${thread.status}, which is terminal; the pointer was released.`,
      released === 'released'
    )
  }

  const escapedOutcome = input.outcome === undefined ? null : escapeStored(input.outcome)
  if (escapedOutcome !== null && escapedOutcome.length > caps.SESSION_BODY_MAX) {
    return { ok: false, refusal: sessionBodyCapRefusal(escapedOutcome.length) }
  }

  const spineContribution: SpineContribution = {
    ...(input.next_step !== undefined ? { next_step: input.next_step } : {}),
    ...(input.next_step_records !== undefined ? { next_step_records: input.next_step_records } : {})
  }
  const spineFieldsUpdated: 'next_step'[] = input.next_step !== undefined ? ['next_step'] : []

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
    return { ok: false, refusal: invalidThreadRecordRefusal(validated.message) }
  }

  const sessionEntry: SessionEntry = {
    id: rt.ulid(),
    thread_id: thread.id,
    actor: PARK_THREAD_ACTOR,
    body: escapedOutcome === null ? '' : escapedOutcome,
    created_at: rt.now()
  }

  const changes: RecordChange[] = [
    { kind: 'thread', record: validated.value },
    { kind: 'session', record: sessionEntry }
  ]

  const committed = store.commit(changes, `park thread ${thread.slug}`)
  if (!committed.ok) {
    return { ok: false, refusal: commitFailureRefusal(committed.detail) }
  }

  const released = releasePointerIfOwned(rt, layout, thread.id)

  return {
    ok: true,
    text:
      escapedOutcome === null
        ? `parked thread ${thread.slug} without an outcome; the session log entry that closes this session was still written.`
        : `parked thread ${thread.slug}.`,
    structured: {
      status: 'parked',
      parked_thread_ids: [thread.id],
      session_entry_ids: [sessionEntry.id],
      spine_fields_updated: spineFieldsUpdated,
      pointer_released: released === 'released',
      ...(stepRecords === null ? {} : { step_records: renderStepRecords(stepRecords, validated.value.spine.next_step) })
    }
  }
}

export const parkThreadTool: ToolSpec<ParkThreadInput, ParkThreadOutput> = {
  name: 'park_thread',
  title: 'Park thread',
  description:
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, sets the next step and the records it needs, and releases the record of what is being worked. The last_session field is no longer accepted here; it is derived from the session log. Send the next step with next_step_records; the thread id is optional because the machine already knows which thread is being worked. The outcome is optional and carries only what the session log does not already hold; omit it and the thread is still parked and the session log entry that closes this session is still written, just carrying no outcome text. Setting next_step requires next_step_records: the records the step needs, found with search_ledger across every thread; the reply returns them in full. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
  input: ParkThreadInputSchema,
  output: ParkThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const checkedStepRecords = checkStepRecords(store, input)
    if (!checkedStepRecords.ok) return { ok: false, refusal: checkedStepRecords }
    const stepRecords = checkedStepRecords.value

    const pointerRead = readPointer(rt, layout.value)

    if (pointerRead.kind === 'corrupt') {
      if (carriesSomethingToStore(input)) {
        return { ok: false, refusal: corruptPointerRefusal(input) }
      }
      releasePointer(rt, layout.value)
      return releasedStatusReply(
        'stale-pointer-released',
        'the record of what is being worked failed to parse; the stale pointer was released.',
        true
      )
    }

    if (pointerRead.kind === 'absent') {
      if (carriesSomethingToStore(input)) {
        return { ok: false, refusal: noWorkedThreadRefusal(input) }
      }
      return emptyStatusReply('nothing-to-park')
    }

    const pointer = pointerRead.value

    if (input.thread_id !== undefined) {
      if (pointer.thread_id !== input.thread_id) {
        if (carriesSomethingToStore(input)) {
          return { ok: false, refusal: notTheWorkedThreadRefusal(input, pointer.thread_id, input.thread_id) }
        }
        return emptyStatusReply('not-the-worked-thread')
      }
      return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input, stepRecords)
    }

    if (pointer.session_id !== rt.sessionId) {
      if (carriesSomethingToStore(input)) {
        return { ok: false, refusal: otherSessionRefusal(input, pointer.thread_id) }
      }
      return emptyStatusReply('not-the-worked-thread')
    }
    return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input, stepRecords)
  }
}
