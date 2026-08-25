import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import type { Decision } from '../../schema/decision.ts'
import { layoutFor } from '../../store/layout.ts'
import { readPointer, writePointer, type Pointer } from '../../domain/pointer.ts'
import { renderBriefing } from '../../render/briefing.ts'
import { openProjectStore, loadThread } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const ResumeThreadInputSchema = z.strictObject({
  thread_id: ulidField(
    'the id of the thread to resume, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, from list_threads or the roster resource'
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
    'Picks up one thread and returns its finished briefing in a single call: it reconciles the store, marks the thread as the one being worked on this machine, and renders what the previous session left. Takes one thread id, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD, which comes from list_threads or the roster resource. Calling it twice on the same thread is not an error and leaves the same single record of what is being worked. The briefing it returns is finished text meant to be shown as it stands.',
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

    const decisionOutcomes = thread.spine.key_decisions.map((keyDecision) => ({
      decisionId: keyDecision.decision_id,
      slot: store.readDecision(keyDecision.decision_id)
    }))

    for (const outcome of decisionOutcomes) {
      if (outcome.slot === null) {
        rt.log({ level: 'error', event: 'briefing.decision-dangling', decision_id: outcome.decisionId })
      } else if (outcome.slot.quarantined) {
        rt.log({ level: 'error', event: 'briefing.decision-quarantined', decision_id: outcome.decisionId })
      }
    }

    const decisions: Decision[] = decisionOutcomes
      .filter(
        (outcome): outcome is { decisionId: string; slot: { quarantined: false; record: Decision } } =>
          outcome.slot !== null && !outcome.slot.quarantined
      )
      .map((outcome) => outcome.slot.record)

    const briefing = renderBriefing(thread, decisions, writtenPointer)

    return {
      ok: true,
      text: briefing,
      structured: {
        thread_id: thread.id,
        briefing,
        previous_session: previousSession
      }
    }
  }
}
