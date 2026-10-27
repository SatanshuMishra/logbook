import { parseDocument, type Status } from '../doc/document.ts'
import { updateRequest, type UpdateReason } from '../doc/rules.ts'
import { recordEvent } from '../metrics/record.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { buildActivity, type Activity } from '../thread/activity.ts'
import { addTranscript, heldBy, readHold } from '../thread/holds.ts'
import { workingCopyPath, type RepoPaths } from '../thread/paths.ts'
import { readDocument } from '../thread/store.ts'
import type { EmptyHookOutput, StopHookOutput } from './output.ts'

export type StopInput = { event: Record<string, unknown>; sessionId: string; paths: RepoPaths; rt: Runtime }

export type StopOutput = EmptyHookOutput | StopHookOutput

const HOOK_EVENT = 'Stop'
const WAITING_KINDS: ReadonlySet<string> = new Set(['blocked', 'waiting'])

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const withTranscript = (transcripts: readonly string[], transcript: string | null): string[] =>
  transcript === null || transcripts.includes(transcript) ? [...transcripts] : [...transcripts, transcript]

const isWaiting = (status: Status | null): status is Status =>
  status !== null && status.kind !== null && WAITING_KINDS.has(status.kind)

const reasonFor = (activity: Activity, status: Status | null): UpdateReason | null => {
  if (activity.changed) return { kind: 'turn-changed' }
  if (activity.userWrote && isWaiting(status)) return { kind: 'blocked-user-wrote', status: status.raw }
  return null
}

export const stop = (input: StopInput): StopOutput => {
  const { event, paths, rt, sessionId } = input
  const held = heldBy(paths, sessionId)
  if (held === null) return {}
  const transcript = nonEmptyString(event.transcript_path)
  if (transcript !== null) addTranscript(rt, paths, held, transcript)
  if (event.stop_hook_active === true) return {}
  const hold = readHold(paths, held)
  const file = workingCopyPath(paths, held)
  const stored = readDocument(rt, paths, held)
  if (hold === null || !file.ok || stored === null) return {}
  const activity = buildActivity({
    transcripts: withTranscript(hold.transcripts, transcript),
    since: hold.folded_at,
    workingCopyPath: file.value
  })
  const reason = reasonFor(activity, parseDocument(stored.text).status)
  if (reason === null) return {}
  recordEvent(rt, paths, held, 'doc.request', { reason: reason.kind })
  return {
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      additionalContext: updateRequest({ path: file.value, documentText: stored.text, reason })
    }
  }
}
