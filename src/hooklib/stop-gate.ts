import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor, type StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { openStore } from '../store/records.ts'
import { readPointer } from '../domain/pointer.ts'
import { ledgerPathsChangedSince, readLedgerHead, readResumeBaseline } from './ledger-presence.ts'
import { collectAssistantTexts, findLastResumeBriefing } from './transcript.ts'
import { readRecordingGateState, writeRecordingGateState, type RecordingGateState, type ThreadFireState } from './recording-gate-state.ts'
import { mismatchAssertionsReason, observationFromThread, untouchedAssertionsReason, type ThreadObservation } from './recording-assertions.ts'

const GATE_FILE_NAME = 'stop-gate.json'

type GateState = { session_id: string }

const gatePathFor = (stateDir: string): string => path.join(stateDir, GATE_FILE_NAME)

const readGate = (stateDir: string): GateState | null => {
  let raw: string
  try {
    raw = readFileSync(gatePathFor(stateDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return typeof parsed.session_id === 'string' && parsed.session_id.length > 0
      ? { session_id: parsed.session_id }
      : null
  } catch {
    return null
  }
}

const writeGate = (rt: Runtime, stateDir: string, sessionId: string): void => {
  durableWrite(gatePathFor(stateDir), JSON.stringify({ session_id: sessionId }), { log: rt.log })
}

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

const verbatimEchoVerdict = (rt: Runtime, event: StopEvent, layout: StoreLayout): StopVerdict => {
  const gate = readGate(layout.state)
  if (gate !== null && gate.session_id === event.session_id) return { kind: 'silent' }

  const pledge = findLastResumeBriefing(event.transcript_path)
  createStateDirectory(layout)
  writeGate(rt, layout.state, event.session_id)

  if (pledge === null) return { kind: 'silent' }
  if (event.stop_hook_active) return { kind: 'silent' }

  const texts = collectAssistantTexts(event.transcript_path)
  const echoed = texts.some((text) => text.includes(pledge))
  if (echoed) return { kind: 'silent' }

  return { kind: 'block', reason: verbatimReason(pledge) }
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

  if (
    fireState !== null &&
    fireState.fires >= STAND_DOWN_MINIMUM_FIRES &&
    fireState.prompt_id_at_last_fire !== event.prompt_id
  ) {
    return { kind: 'silent' }
  }

  const reference = fireState !== null ? fireState.head_at_last_fire : baselineHead

  const fire = (reason: string): StopVerdict => {
    recordFire(rt, layout, gateState, event, threadId, head)
    return { kind: 'block', reason }
  }

  if (head === reference) {
    const observation = observeThread(rt, layout.projectRoot, threadId)
    return fire(untouchedAssertionsReason(threadId, observation))
  }

  const diff = ledgerPathsChangedSince(rt, layout.projectRoot, reference)
  if (!diff.ok) return { kind: 'silent' }
  if (diff.paths.length === 0) {
    const observation = observeThread(rt, layout.projectRoot, threadId)
    return fire(untouchedAssertionsReason(threadId, observation))
  }

  const touchesHeldThread = diff.paths.some(
    (changedPath) => changedPath === `threads/${threadId}.json` || changedPath.startsWith(`sessions/${threadId}/`)
  )
  if (touchesHeldThread) return { kind: 'silent' }

  const observation = observeThread(rt, layout.projectRoot, threadId)
  return fire(mismatchAssertionsReason(threadId, observation))
}

export const stopGateVerdict = (rt: Runtime, event: StopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  const verbatim = verbatimEchoVerdict(rt, event, layout.value)
  if (verbatim.kind === 'block') return verbatim

  return ledgerPresenceVerdict(rt, event, layout.value)
}
