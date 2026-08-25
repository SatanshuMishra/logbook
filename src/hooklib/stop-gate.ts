import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
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

export const stopGateVerdict = (rt: Runtime, event: StopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  const gate = readGate(layout.value.state)
  if (gate !== null && gate.session_id === event.session_id) return { kind: 'silent' }

  const pledge = findLastResumeBriefing(event.transcript_path)
  createStateDirectory(layout.value)
  writeGate(rt, layout.value.state, event.session_id)

  if (pledge === null) return { kind: 'silent' }
  if (event.stop_hook_active) return { kind: 'silent' }

  const texts = collectAssistantTexts(event.transcript_path)
  const echoed = texts.some((text) => text.includes(pledge))
  if (echoed) return { kind: 'silent' }

  return { kind: 'block', reason: verbatimReason(pledge) }
}
