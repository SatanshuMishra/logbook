import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor, type StoreLayout } from '../store/layout.ts'
import { openStore } from '../store/records.ts'
import { readPointer } from '../domain/pointer.ts'
import { ledgerPathsChangedSince, readLedgerHead, readResumeBaseline } from './ledger-presence.ts'
import { assistantTextsAfter, isPickupTurn, readTurnResumeResults, type TurnResumeResult } from './transcript.ts'
import { readRecordingGateState, writeRecordingGateState, type RecordingGateState, type ThreadFireState } from './recording-gate-state.ts'
import { mismatchAssertionsReason, observationFromThread, untouchedAssertionsReason, type ThreadObservation } from './recording-assertions.ts'

export type StopVerdict = { kind: 'silent' } | { kind: 'block'; reason: string }

export type StopEvent = {
  session_id: string
  cwd: string
  transcript_path: unknown
  stop_hook_active: boolean
  prompt_id: string | null
}

const verbatimReason = (owedText: string): string =>
  `Logbook: the preflight briefing owed to this turn was not printed verbatim. The server owns every heading, ` +
  `separator and ordering. Print the text below exactly as it stands, with nothing added, removed, reordered or ` +
  `reworded.\n\n${owedText}`

const BLOCKQUOTE_MARKER_PATTERN = /^ {0,3}> ?/

const stripLeadingBlockquoteMarker = (line: string): string => {
  const match = BLOCKQUOTE_MARKER_PATTERN.exec(line)
  return match === null ? line : line.slice(match[0].length)
}

const normaliseBlockquoteMarkers = (text: string): string =>
  text.split('\n').map(stripLeadingBlockquoteMarker).join('\n')

type OwedBriefing = { position: number; briefing: string }

const pickupBriefingOf = (result: TurnResumeResult): OwedBriefing | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const reply = parsed as Record<string, unknown>
  if (reply.pickup !== true || typeof reply.briefing !== 'string') return null
  return { position: result.position, briefing: reply.briefing }
}

const owedBriefingFor = (event: StopEvent): OwedBriefing | null =>
  readTurnResumeResults(event.transcript_path, event.prompt_id)
    .map(pickupBriefingOf)
    .filter((owed): owed is OwedBriefing => owed !== null)
    .at(-1) ?? null

const printedIn = (texts: readonly string[], briefing: string): boolean => {
  const normalisedBriefing = normaliseBlockquoteMarkers(briefing)
  return texts.some((text) => normaliseBlockquoteMarkers(text).includes(normalisedBriefing))
}

const verbatimEchoVerdict = (event: StopEvent): StopVerdict => {
  if (event.stop_hook_active) return { kind: 'silent' }

  const owed = owedBriefingFor(event)
  if (owed === null) return { kind: 'silent' }

  const textsAfterReply = assistantTextsAfter(event.transcript_path, owed.position)
  if (textsAfterReply === null) return { kind: 'silent' }
  if (printedIn(textsAfterReply, owed.briefing)) return { kind: 'silent' }

  return { kind: 'block', reason: verbatimReason(owed.briefing) }
}

const STAND_DOWN_MINIMUM_FIRES = 2

const fireStateFor = (state: RecordingGateState | null, sessionId: string, threadId: string): ThreadFireState | null => {
  if (state === null || state.session_id !== sessionId) return null
  return state.threads[threadId] ?? null
}

const observeThread = (rt: Runtime, projectRoot: string, threadId: string): ThreadObservation | null => {
  const opened = openStore(rt, projectRoot)
  if (!opened.ok) return null
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) return null
  return observationFromThread(slot.record)
}

const recordFire = (
  rt: Runtime,
  layout: StoreLayout,
  previousState: RecordingGateState | null,
  event: StopEvent,
  threadId: string,
  head: string
): void => {
  const previousThreads =
    previousState !== null && previousState.session_id === event.session_id ? previousState.threads : {}
  const previousFires = previousThreads[threadId]?.fires ?? 0
  const nextState: RecordingGateState = {
    session_id: event.session_id,
    head_at_last_fire: head,
    threads: {
      ...previousThreads,
      [threadId]: {
        head_at_last_fire: head,
        fires: previousFires + 1,
        prompt_id_at_last_fire: event.prompt_id
      }
    }
  }
  writeRecordingGateState(rt, layout.state, nextState)
}

const clearFire = (
  rt: Runtime,
  layout: StoreLayout,
  previousState: RecordingGateState | null,
  previousFireState: ThreadFireState | null,
  event: StopEvent,
  threadId: string,
  head: string
): void => {
  const previousSessionHead =
    previousState !== null && previousState.session_id === event.session_id ? previousState.head_at_last_fire : null
  if (
    previousFireState !== null &&
    previousFireState.head_at_last_fire === head &&
    previousSessionHead === head
  ) return
  const previousThreads =
    previousState !== null && previousState.session_id === event.session_id ? previousState.threads : {}
  const nextState: RecordingGateState = {
    session_id: event.session_id,
    head_at_last_fire: head,
    threads: {
      ...previousThreads,
      [threadId]: {
        head_at_last_fire: head,
        fires: previousFireState?.fires ?? 0,
        prompt_id_at_last_fire: previousFireState?.prompt_id_at_last_fire ?? null
      }
    }
  }
  writeRecordingGateState(rt, layout.state, nextState)
}

const ledgerPresenceVerdict = (rt: Runtime, event: StopEvent, layout: StoreLayout): StopVerdict => {
  if (event.stop_hook_active) return { kind: 'silent' }

  const pointerRead = readPointer(rt, layout)
  if (pointerRead.kind !== 'pointer') return { kind: 'silent' }
  if (pointerRead.value.session_id !== event.session_id) return { kind: 'silent' }

  const baseline = readResumeBaseline(layout)
  if (baseline === null) return { kind: 'silent' }
  if (baseline.session_id !== event.session_id) return { kind: 'silent' }
  const baselineHead = baseline.ledger_head
  if (baselineHead === null) return { kind: 'silent' }

  const head = readLedgerHead(rt, layout.projectRoot)
  if (head === null) return { kind: 'silent' }

  const threadId = pointerRead.value.thread_id
  const gateState = readRecordingGateState(rt, layout.state)
  const fireState = fireStateFor(gateState, event.session_id, threadId)

  if (fireState !== null && fireState.fires >= STAND_DOWN_MINIMUM_FIRES) {
    const freshTurn = event.prompt_id === null || fireState.prompt_id_at_last_fire !== event.prompt_id
    if (freshTurn) return { kind: 'silent' }
  }

  const reference = fireState !== null ? fireState.head_at_last_fire : baselineHead

  const fire = (reasonFor: (threadId: string, observation: ThreadObservation | null) => string): StopVerdict => {
    if (isPickupTurn(event.transcript_path, event.prompt_id)) return { kind: 'silent' }
    const observation = observeThread(rt, layout.projectRoot, threadId)
    recordFire(rt, layout, gateState, event, threadId, head)
    return { kind: 'block', reason: reasonFor(threadId, observation) }
  }

  if (head === reference) return fire(untouchedAssertionsReason)

  const diff = ledgerPathsChangedSince(rt, layout.projectRoot, reference)
  if (!diff.ok) return { kind: 'silent' }
  if (diff.paths.length === 0) return fire(untouchedAssertionsReason)

  const touchesHeldThread = diff.paths.some(
    (changedPath) => changedPath === `threads/${threadId}.json` || changedPath.startsWith(`sessions/${threadId}/`)
  )
  if (touchesHeldThread) {
    clearFire(rt, layout, gateState, fireState, event, threadId, head)
    return { kind: 'silent' }
  }

  return fire(mismatchAssertionsReason)
}

export const stopGateVerdict = (rt: Runtime, event: StopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  const verbatim = verbatimEchoVerdict(event)
  if (verbatim.kind === 'block') return verbatim

  return ledgerPresenceVerdict(rt, event, layout.value)
}
