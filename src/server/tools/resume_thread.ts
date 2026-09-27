import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import { ULID_LENGTH } from '../../schema/ulid-length.ts'
import { layoutFor } from '../../store/layout.ts'
import { readPointer, writePointer, type Pointer } from '../../domain/pointer.ts'
import { renderHandle, renderStepBriefing, type DecisionIntegrity } from '../../render/briefing.ts'
import { readBriefed, recordBriefed } from '../../domain/briefed.ts'
import { openProjectStore, loadThread } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const ResumeThreadInputSchema = z.strictObject({
  thread_id: ulidField(
    `the id of the thread to resume, a ${ULID_LENGTH}-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, from list_threads or the roster resource`
  ),
  full_briefing: z
    .boolean()
    .optional()
    .describe(
      'render the whole briefing even when this session has already been briefed on this thread; the first resume of a thread in a session returns the whole briefing and later ones return its head, and this asks for the whole text back, for a session whose context no longer holds it'
    )
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
  )
})

type ResumeThreadInput = z.infer<typeof ResumeThreadInputSchema>
type ResumeThreadOutput = z.infer<typeof ResumeThreadOutputSchema>

export const resumeThreadTool: ToolSpec<ResumeThreadInput, ResumeThreadOutput> = {
  name: 'resume_thread',
  title: 'Resume thread',
  description:
    `Picks up one thread and returns its finished briefing in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left. Takes one thread id, a ${ULID_LENGTH}-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The first resume of a thread in a session returns the whole briefing and every later resume of it returns the head of that briefing, which names what it leaves out; pass full_briefing to ask for the whole text back. Either way the text it returns is finished and meant to be shown as it stands.`,
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

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const priorPointerRead = readPointer(rt, layout.value)
    const previousSession =
      priorPointerRead.kind === 'pointer' && priorPointerRead.value.session_id !== rt.sessionId
        ? { thread_id: priorPointerRead.value.thread_id, written_at: priorPointerRead.value.written_at }
        : null

    const writtenPointer: Pointer = { thread_id: thread.id, written_at: rt.now(), session_id: rt.sessionId }
    writePointer(rt, layout.value, writtenPointer)

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

    const sessionEntrySlots = store.readSessionEntries(thread.id)
    const unreadableSessionEntryCount = sessionEntrySlots.filter((slot) => slot.quarantined).length
    const rendersFull = input.full_briefing === true || !readBriefed(rt, layout.value).includes(thread.id)

    const briefing = rendersFull
      ? renderStepBriefing(store, thread, writtenPointer)
      : renderHandle(thread, decisionIntegrity, writtenPointer, unreadableSessionEntryCount)

    if (rendersFull) recordBriefed(rt, layout.value, thread.id)

    return {
      ok: true,
      text: '',
      structured: {
        thread_id: thread.id,
        briefing,
        previous_session: previousSession
      }
    }
  }
}
