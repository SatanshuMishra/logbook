import { parseDocument, type Status } from '../doc/document.ts'
import { updateRequest, type UpdateReason } from '../doc/rules.ts'
import { recordEvent } from '../metrics/record.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { buildActivity, type Activity } from '../thread/activity.ts'
import { addTranscript, heldBy, markProvisionalAsked, readHold, type Hold } from '../thread/holds.ts'
import { RUN_WRITER_PREFIX, workingCopyPath, type RepoPaths } from '../thread/paths.ts'
import { lastWriter, readDocument } from '../thread/store.ts'
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

const runWroteLast = (rt: Runtime, paths: RepoPaths, slug: string): boolean =>
  lastWriter(rt, paths, slug)?.startsWith(RUN_WRITER_PREFIX) === true

const sessionDidTheWork = (activity: Activity, runHoldsTheDocument: () => boolean): boolean =>
  activity.changed && (activity.edited || !runHoldsTheDocument())

const reasonFor = (
  activity: Activity,
  status: Status | null,
  runHoldsTheDocument: () => boolean
): UpdateReason | null => {
  if (sessionDidTheWork(activity, runHoldsTheDocument)) return { kind: 'turn-changed' }
  if (activity.userWrote && isWaiting(status)) return { kind: 'blocked-user-wrote', status: status.raw }
  return null
}

const requestOutput = (text: string): StopHookOutput => ({
  hookSpecificOutput: { hookEventName: HOOK_EVENT, additionalContext: text }
})

const provisionalReason = (hold: Hold, reason: UpdateReason | null): UpdateReason | null =>
  hold.provisional_asked !== true && reason?.kind === 'turn-changed' ? reason : null

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
  const judged = reasonFor(activity, parseDocument(stored.text).status, () => runWroteLast(rt, paths, held))
  const provisional = hold.provisional === true
  const reason = provisional ? provisionalReason(hold, judged) : judged
  if (reason === null) return {}
  recordEvent(rt, paths, held, 'doc.request', { reason: reason.kind })
  const text = updateRequest({ path: file.value, documentText: stored.text, reason, provisional })
  if (provisional) markProvisionalAsked(rt, paths, held)
  return requestOutput(text)
}
