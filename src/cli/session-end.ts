import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { readPointer } from '../domain/pointer.ts'

export type SessionEndEvent = { session_id: string; reason: string; cwd: string }

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const parseSessionEndEvent = (raw: unknown): SessionEndEvent | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const event = raw as Record<string, unknown>
  if (!isNonEmptyString(event.session_id)) return null
  if (!isNonEmptyString(event.reason)) return null
  if (!isNonEmptyString(event.cwd)) return null
  return { session_id: event.session_id, reason: event.reason, cwd: event.cwd }
}

const RESUME_TERMINATION_REASON = 'resume'

const handoffMessage = (threadId: string): string =>
  `Logbook: thread ${threadId} was left marked as being worked when this session ended. Run the debrief skill ` +
  'next session to hand it off, or resume it to keep going.'

export type SessionEndReply = { message: string | null }

export const runSessionEnd = (rt: Runtime, event: SessionEndEvent): SessionEndReply => {
  if (event.reason === RESUME_TERMINATION_REASON) return { message: null }

  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { message: null }

  const pointerRead = readPointer(rt, layout.value)
  if (pointerRead.kind !== 'pointer') return { message: null }
  if (pointerRead.value.session_id !== event.session_id) return { message: null }

  return { message: handoffMessage(pointerRead.value.thread_id) }
}
