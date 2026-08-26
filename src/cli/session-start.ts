import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { openStore } from '../store/records.ts'
import type { Thread } from '../store/records.ts'
import { readPointer } from '../domain/pointer.ts'
import { escapeStored } from '../render/escape.ts'

export type SessionStartEvent = { session_id: string; source: string; cwd: string }

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const parseSessionStartEvent = (raw: unknown): SessionStartEvent | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const event = raw as Record<string, unknown>
  if (!isNonEmptyString(event.session_id)) return null
  if (!isNonEmptyString(event.source)) return null
  if (!isNonEmptyString(event.cwd)) return null
  return { session_id: event.session_id, source: event.source, cwd: event.cwd }
}

const NO_RESUMABLE_THREADS = 'Logbook: no resumable threads.'

const renderThreadLine = (thread: Thread): string =>
  `- ${escapeStored(thread.slug)}: ${escapeStored(thread.title)} -- next: ` +
  `${escapeStored(thread.spine.next_step)} (id ${escapeStored(thread.id)})`

export const renderThreadListing = (rt: Runtime, projectRoot: string): string => {
  const opened = openStore(rt, projectRoot)
  if (!opened.ok) {
    return ['Logbook: the thread store could not be opened (', escapeStored(opened.message), ').'].join('')
  }
  const threads = opened.value
    .readThreads()
    .filter((slot): slot is { quarantined: false; record: Thread } => !slot.quarantined)
    .map((slot) => slot.record)
    .filter((thread) => thread.status === 'open')
  if (threads.length === 0) return NO_RESUMABLE_THREADS
  const threadLines = threads.map(renderThreadLine)
  return [`Logbook resumable threads (${threads.length}):`, ...threadLines].join('\n')
}

const renderCrashReport = (rt: Runtime, projectRoot: string, sessionId: string): string | null => {
  const layout = layoutFor(rt, projectRoot)
  if (!layout.ok) return null
  const pointerRead = readPointer(rt, layout.value)
  if (pointerRead.kind !== 'pointer') return null
  if (pointerRead.value.session_id === sessionId) return null
  return (
    `Logbook: a pointer left by a previous session still marks thread ${escapeStored(pointerRead.value.thread_id)} as being ` +
    `worked (since ${escapeStored(pointerRead.value.written_at)}). That session may have crashed or been abandoned without ` +
    'handing off.'
  )
}

export type SessionStartReply = { additionalContext: string }

export const runSessionStart = (rt: Runtime, event: SessionStartEvent): SessionStartReply => {
  const crashReport = renderCrashReport(rt, event.cwd, event.session_id)
  const listing = renderThreadListing(rt, event.cwd)
  const sections = crashReport === null ? [listing] : [crashReport, listing]
  return { additionalContext: sections.join('\n\n') }
}
