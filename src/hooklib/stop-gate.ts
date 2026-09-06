import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor, type StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { readPointer } from '../domain/pointer.ts'
import { ledgerPathsChangedSince, readLedgerHead, readResumeBaseline } from './ledger-presence.ts'
import { collectAssistantTexts, findLastResumeBriefing } from './transcript.ts'

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
}

const verbatimReason = (owedText: string): string =>
  `Logbook: the preflight briefing owed to this turn was not printed verbatim. The server owns every heading, ` +
  `separator and ordering. Print the text below exactly as it stands, with nothing added, removed, reordered or ` +
  `reworded.\n\n${owedText}`

const ledgerUntouchedReason = (threadId: string): string =>
  `Logbook: nothing has reached this project's ledger since the thread ${threadId} was resumed. Record what was ` +
  `established with record_decision, note progress with update_thread, or end this session's work on the thread ` +
  `with park_thread. This verdict reports only that something reached the ledger; it makes no claim that what is ` +
  `recorded is complete.`

const ledgerMismatchReason = (threadId: string): string =>
  `Logbook: records have reached this project's ledger, but none of them is filed under thread ${threadId}. Record ` +
  `what was established with record_decision, note progress with update_thread, or end this session's work on the ` +
  `thread with park_thread. This verdict reports only that something reached the ledger; it makes no claim that ` +
  `what is recorded is complete.`

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

const ledgerPresenceVerdict = (rt: Runtime, event: StopEvent, layout: StoreLayout): StopVerdict => {
  if (event.stop_hook_active) return { kind: 'silent' }

  const pointerRead = readPointer(rt, layout)
  if (pointerRead.kind !== 'pointer') return { kind: 'silent' }
  if (pointerRead.value.session_id !== event.session_id) return { kind: 'silent' }

  const baseline = readResumeBaseline(layout)
  if (baseline === null) return { kind: 'silent' }
  if (baseline.session_id !== event.session_id) return { kind: 'silent' }
  if (baseline.ledger_head === null) return { kind: 'silent' }

  const head = readLedgerHead(rt, layout.projectRoot)
  if (head === null) return { kind: 'silent' }
  if (head === baseline.ledger_head) return { kind: 'block', reason: ledgerUntouchedReason(pointerRead.value.thread_id) }

  const changed = ledgerPathsChangedSince(rt, layout.projectRoot, baseline.ledger_head)
  if (changed.length === 0) return { kind: 'silent' }

  const threadId = pointerRead.value.thread_id
  const touchesHeldThread = changed.some(
    (changedPath) => changedPath === `threads/${threadId}.json` || changedPath.startsWith(`sessions/${threadId}/`)
  )
  if (touchesHeldThread) return { kind: 'silent' }

  return { kind: 'block', reason: ledgerMismatchReason(threadId) }
}

export const stopGateVerdict = (rt: Runtime, event: StopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  const verbatim = verbatimEchoVerdict(rt, event, layout.value)
  if (verbatim.kind === 'block') return verbatim

  return ledgerPresenceVerdict(rt, event, layout.value)
}
