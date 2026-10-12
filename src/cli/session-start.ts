import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { openStore } from '../store/records.ts'
import type { Thread } from '../store/records.ts'
import { readPointer } from '../domain/pointer.ts'
import { criterionRecord, placeOf, type IndexedRecord } from '../domain/record-index.ts'
import { displayStored, escapeStored } from '../render/escape.ts'
import { clipWithMarker, HOOK_CONTEXT_MAX_CODE_UNITS, markerClipGraphemesWithin } from '../render/clip.ts'
import { stepRecordIds } from '../render/briefing.ts'
import { renderCompactBriefing } from '../render/compact-briefing.ts'
import { selectRosterThreads } from '../render/roster.ts'
import { readResumeBaseline, recordSessionBaseline } from '../hooklib/ledger-presence.ts'
import { loadHookRecordIndex, readIndexedRecord } from '../hooklib/record-index-cache.ts'

export type SessionStartEvent = { session_id: string; source: string; cwd: string }

const LISTED_THREADS_MAX = 20

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
const LINE_BREAK = '\n'
const SECTION_SEPARATOR = '\n\n'

const renderThreadLine = (thread: Thread): string =>
  `- ${displayStored(thread.slug, 'prose', 'mid-line')}: ${displayStored(thread.title, 'prose', 'mid-line')} -- next: ` +
  `${displayStored(thread.spine.next_step, 'prose', 'mid-line')} (id ${escapeStored(thread.id)})`

type LineBudgets = { title: number; nextStep: number }

const lineBudgets = (thread: Thread, max: number): LineBudgets => {
  const title = displayStored(thread.title, 'prose', 'mid-line')
  const nextStep = displayStored(thread.spine.next_step, 'prose', 'mid-line')
  const room = Math.max(0, max - (renderThreadLine(thread).length - title.length - nextStep.length))
  const titleRoom = Math.max(Math.floor(room / 2), room - nextStep.length)
  return {
    title: markerClipGraphemesWithin(title, titleRoom),
    nextStep: markerClipGraphemesWithin(nextStep, room - Math.min(title.length, titleRoom))
  }
}

const clippedThreadLine = (thread: Thread, max: number): string => {
  const budgets = lineBudgets(thread, max)
  return (
    `- ${displayStored(thread.slug, 'prose', 'mid-line')}: ` +
    `${clipWithMarker(displayStored(thread.title, 'prose', 'mid-line'), budgets.title)} -- next: ` +
    `${clipWithMarker(displayStored(thread.spine.next_step, 'prose', 'mid-line'), budgets.nextStep)} (id ${escapeStored(thread.id)})`
  )
}

const listingHeader = (count: number): string => `Logbook resumable threads (${count}):`

const countLine = (leftOut: number): string =>
  `${leftOut} more open ${leftOut === 1 ? 'thread' : 'threads'}: list_threads or logbook://roster`

const listingOf = (threads: readonly Thread[], listed: number): string =>
  [
    listingHeader(threads.length),
    ...threads.slice(0, listed).map(renderThreadLine),
    ...(listed < threads.length ? [countLine(threads.length - listed)] : [])
  ].join(LINE_BREAK)

const listedCount = (threads: readonly Thread[], budget: number): number =>
  Array.from({ length: Math.min(LISTED_THREADS_MAX, threads.length) }, (_unused, index) => index + 1).reduce(
    (listed, candidate) => (listingOf(threads, candidate).length <= budget ? candidate : listed),
    0
  )

const clippedLineRoom = (threads: readonly Thread[], budget: number): number =>
  budget -
  listingHeader(threads.length).length -
  LINE_BREAK.length -
  (threads.length > 1 ? LINE_BREAK.length + countLine(threads.length - 1).length : 0)

const listingWithClippedFirst = (threads: readonly Thread[], first: Thread, budget: number): string =>
  [
    listingHeader(threads.length),
    clippedThreadLine(first, clippedLineRoom(threads, budget)),
    ...(threads.length > 1 ? [countLine(threads.length - 1)] : [])
  ].join(LINE_BREAK)

const boundedListing = (threads: readonly Thread[], budget: number): string => {
  const listed = listedCount(threads, budget)
  const first = threads[0]
  return listed > 0 || first === undefined ? listingOf(threads, listed) : listingWithClippedFirst(threads, first, budget)
}

export const renderThreadListing = (
  rt: Runtime,
  projectRoot: string | null,
  budget: number = HOOK_CONTEXT_MAX_CODE_UNITS
): string => {
  const opened = openStore(rt, projectRoot)
  if (!opened.ok) {
    return ['Logbook: the thread store could not be opened (', escapeStored(opened.message, 'paren-wrapped'), ').'].join('')
  }
  const threads = selectRosterThreads(opened.value.readResumable().resumable)
  if (threads.length === 0) return NO_RESUMABLE_THREADS
  return boundedListing(threads, budget)
}

export const renderCrashReport = (rt: Runtime, projectRoot: string, sessionId: string): string | null => {
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

const BASELINE_UNWRITABLE_EVENT = 'session-start.baseline-unwritable'

const recordSessionBaselineIfNew = (rt: Runtime, event: SessionStartEvent): void => {
  try {
    const layout = layoutFor(rt, event.cwd)
    if (!layout.ok) return
    const existing = readResumeBaseline(layout.value)
    if (existing !== null && existing.session_id === event.session_id) return
    recordSessionBaseline(rt, layout.value, event.session_id)
  } catch (error) {
    rt.log({
      level: 'warn',
      event: BASELINE_UNWRITABLE_EVENT,
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}

const COMPACT_SOURCE = 'compact'
const COMPACT_BRIEFING_FAILED_EVENT = 'session-start.compact-briefing-failed'

const createdAtOf = (record: IndexedRecord): string => (record.kind === 'decision' ? record.decision.created_at : '')

const newestFirst = (left: IndexedRecord, right: IndexedRecord): number => {
  const byCreation = createdAtOf(right).localeCompare(createdAtOf(left))
  if (byCreation !== 0) return byCreation
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}

const heldThreadBriefing = (rt: Runtime, event: SessionStartEvent): string | null => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return null
  const pointer = readPointer(rt, layout.value)
  if (pointer.kind !== 'pointer' || pointer.value.session_id !== event.session_id) return null
  const opened = openStore(rt, event.cwd)
  if (!opened.ok) return null
  const slot = opened.value.readThread(pointer.value.thread_id)
  if (slot === null || slot.quarantined) return null
  const thread = slot.record
  const index = loadHookRecordIndex(rt, layout.value)
  const threadsRead = new Map([[thread.id, thread] as const])
  const named = stepRecordIds(thread).map((id) => ({ id, record: readIndexedRecord(opened.value, index, id, threadsRead) }))
  const stepRecords = named.flatMap(({ record }) => (record === null ? [] : [record]))
  const shown = new Set(stepRecords.map((record) => record.id))
  const place = placeOf(thread)
  const linked = new Set(thread.spine.key_decisions.map((link) => link.decision_id))
  return renderCompactBriefing(
    {
      thread,
      stepRecords,
      unreadableStepIds: named.flatMap(({ id, record }) => (record === null ? [id] : [])),
      openCriteria: thread.completion_criteria
        .filter((criterion) => !criterion.done && criterion.struck_by === null && !shown.has(criterion.id))
        .map((criterion) => criterionRecord(place, criterion)),
      decisions: [
        ...index.liveDecisions.filter(
          (record) => !shown.has(record.id) && (record.threadId === thread.id || linked.has(record.id))
        )
      ].sort(newestFirst),
      risks: index.liveRisks.filter((record) => record.threadId === thread.id && !shown.has(record.id)),
      entryCount: index.entryCount(thread.id)
    },
    HOOK_CONTEXT_MAX_CODE_UNITS
  )
}

const compactBriefingFor = (rt: Runtime, event: SessionStartEvent): string | null => {
  try {
    return heldThreadBriefing(rt, event)
  } catch (error) {
    rt.log({
      level: 'warn',
      event: COMPACT_BRIEFING_FAILED_EVENT,
      detail: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

export type SessionStartReply = { additionalContext: string }

export const runSessionStart = (rt: Runtime, event: SessionStartEvent): SessionStartReply => {
  recordSessionBaselineIfNew(rt, event)
  const compact = event.source === COMPACT_SOURCE ? compactBriefingFor(rt, event) : null
  if (compact !== null) return { additionalContext: compact }
  const crashReport = renderCrashReport(rt, event.cwd, event.session_id)
  const listingBudget = HOOK_CONTEXT_MAX_CODE_UNITS - (crashReport === null ? 0 : crashReport.length + SECTION_SEPARATOR.length)
  const listing = renderThreadListing(rt, event.cwd, Math.max(0, listingBudget))
  const sections = crashReport === null ? [listing] : [crashReport, listing]
  return { additionalContext: sections.join(SECTION_SEPARATOR) }
}
