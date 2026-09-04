import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { layoutFor } from '../../store/layout.ts'
import { readPointer, writePointer, type Pointer } from '../../domain/pointer.ts'
import { recordResumeBaseline } from '../../hooklib/ledger-presence.ts'
import { renderBriefingWithPasses, resumePayloadBytes, type DecisionIntegrity } from '../../render/briefing.ts'
import { openProjectStore, loadThread, resolvePredecessor } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const ResumeThreadInputSchema = z.strictObject({
  thread_id: ulidField(
    'the id of the thread to resume, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, from list_threads or the roster resource'
  ),
  focus: z
    .array(ulidField('a completion criterion this session is focused on; refused when it names no criterion on this thread'))
    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
    .optional()
    .describe(
      'which completion criteria this session is focused on, recorded on the session pointer this call writes and never on the thread record; omit for none'
    )
})

export const unknownFocusRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'focus',
  accepted: 'a criterion_id that names a completion criterion already present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `focus names ids not present on this thread: ${ids.join(', ')}.`
})

const duplicateFocusRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'focus',
  accepted: 'at most one entry per criterion id in a single call',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `focus names the same criterion more than once: ${ids.join(', ')}.`
})

const PreviousSessionSchema = z.object({
  thread_id: z.string().describe('the id of the thread a previous session left marked as being worked'),
  written_at: z.string().describe('when the previous session marked that thread as being worked')
})

const ResumeThreadOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread that was resumed'),
  briefing: z.string().describe('the finished briefing text for this thread, ready to be shown as it stands'),
  previous_session: PreviousSessionSchema.nullable().describe(
    'the thread a previous session left marked as being worked, or null when this session already held the pointer or nothing was marked'
  ),
  focus: z.array(z.string()).describe('the focus this call recorded on the session pointer, exactly as stored; empty when none was supplied')
})

type ResumeThreadInput = z.infer<typeof ResumeThreadInputSchema>
type ResumeThreadOutput = z.infer<typeof ResumeThreadOutputSchema>

export const resumeThreadTool: ToolSpec<ResumeThreadInput, ResumeThreadOutput> = {
  name: 'resume_thread',
  title: 'Resume thread',
  description:
    'Picks up one thread and returns its finished briefing in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left. Takes one thread id, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The briefing it returns is finished text meant to be shown as it stands.',
  input: ResumeThreadInputSchema,
  output: ResumeThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const focusIds = input.focus ?? []
    const duplicatedFocusIds = focusIds.filter((id, index) => focusIds.indexOf(id) !== index)
    if (duplicatedFocusIds.length > 0) {
      return { ok: false, refusal: duplicateFocusRefusal([...new Set(duplicatedFocusIds)]) }
    }
    const unknownFocusIds = focusIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
    if (unknownFocusIds.length > 0) {
      return { ok: false, refusal: unknownFocusRefusal(unknownFocusIds) }
    }

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const priorPointerRead = readPointer(rt, layout.value)
    const previousSession =
      priorPointerRead.kind === 'pointer' && priorPointerRead.value.session_id !== rt.sessionId
        ? { thread_id: priorPointerRead.value.thread_id, written_at: priorPointerRead.value.written_at }
        : null

    const writtenPointer: Pointer = { thread_id: thread.id, written_at: rt.now(), session_id: rt.sessionId, focus: focusIds }
    writePointer(rt, layout.value, writtenPointer)
    recordResumeBaseline(rt, layout.value, rt.sessionId)

    const decisionIds = thread.spine.key_decisions.map((keyDecision) => keyDecision.decision_id)
    const probe = store.probeDecisions(decisionIds)

    for (const decisionId of probe.dangling) {
      rt.log({ level: 'error', event: 'briefing.decision-dangling', decision_id: decisionId })
    }
    for (const decisionId of probe.quarantined) {
      rt.log({ level: 'error', event: 'briefing.decision-quarantined', decision_id: decisionId })
    }

    const decisionIntegrity: DecisionIntegrity = {
      resolved: probe.resolved,
      dangling: probe.dangling,
      quarantined: probe.quarantined
    }

    const hasPreviousSession = previousSession !== null
    const sessionEntrySlots = store.readSessionEntries(thread.id)
    const sessionEntries = sessionEntrySlots.flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
    const unreadableSessionEntryCount = sessionEntrySlots.filter((slot) => slot.quarantined).length
    const render = renderBriefingWithPasses(
      thread,
      decisionIntegrity,
      writtenPointer,
      resolvePredecessor(rt, store, thread),
      hasPreviousSession,
      sessionEntries,
      unreadableSessionEntryCount
    )
    const briefing = render.briefing

    if (!render.withinBudget) {
      rt.log({
        level: 'error',
        event: 'briefing.budget-exceeded',
        chars: briefing.length,
        bytes: resumePayloadBytes(briefing, thread.id, hasPreviousSession, focusIds.length)
      })
    }

    return {
      ok: true,
      text: briefing,
      structured: {
        thread_id: thread.id,
        briefing,
        previous_session: previousSession,
        focus: focusIds
      }
    }
  }
}
