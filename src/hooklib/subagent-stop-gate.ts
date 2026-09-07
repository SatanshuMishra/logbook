import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { readLedgerHead, readResumeBaseline } from './ledger-presence.ts'
import { headAtLastFireFor, readRecordingGateState } from './recording-gate-state.ts'
import { recordingGateClosingText } from './recording-assertions.ts'
import type { StopVerdict } from './stop-gate.ts'

export type SubagentStopEvent = { session_id: string; cwd: string; agent_id: string | null; agent_type: string }

const SUBAGENT_GATE_DIR_NAME = 'subagent-gate'

const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

const isSafePathSegment = (value: string): boolean =>
  SAFE_PATH_SEGMENT_PATTERN.test(value) && value !== '.' && value !== '..'

const markerPathFor = (stateDir: string, sessionId: string, agentId: string): string =>
  path.join(stateDir, SUBAGENT_GATE_DIR_NAME, sessionId, agentId)

const markerExists = (stateDir: string, sessionId: string, agentId: string): boolean =>
  existsSync(markerPathFor(stateDir, sessionId, agentId))

const writeMarker = (rt: Runtime, stateDir: string, sessionId: string, agentId: string): void => {
  const target = markerPathFor(stateDir, sessionId, agentId)
  mkdirSync(path.dirname(target), { recursive: true })
  durableWrite(target, '', { log: rt.log })
}

const R1_TEXT = 'Every cause, measurement or approach this agent established is on the record.'
const R2_TEXT = 'Every approach tried and abandoned is recorded, with what made it fail.'
const R3_TEXT = 'Every fault this agent observed in what it read is recorded, and nothing it merely imagines is.'
const R4_TEXT = 'Every file this agent produced or changed is named.'
const R5_TEXT = 'Where the work stopped is recorded, when it stopped short of its brief.'
const R6_TEXT = 'Everything this agent could not determine is recorded, with what blocked it.'

const SUBAGENT_ASSERTION_LINES = [R1_TEXT, R2_TEXT, R3_TEXT, R4_TEXT, R5_TEXT, R6_TEXT]

const SUBAGENT_RECORDING_ACTION_TEXT =
  'Where this agent holds a ledger tool, record it there before returning. Where it does not, put every one of ' +
  "these in this agent's own return message, so the session that reads that return message can record it."

const subagentBlockReason = (): string =>
  "Logbook: this agent's work is about to leave the only context that holds it. A session picking up this " +
  'work would need each of the following to hold.\n\n' +
  SUBAGENT_ASSERTION_LINES.map((line) => `- ${line}`).join('\n') +
  `\n\n${SUBAGENT_RECORDING_ACTION_TEXT} ${recordingGateClosingText()}`

export const subagentStopGateVerdict = (rt: Runtime, event: SubagentStopEvent): StopVerdict => {
  const layout = layoutFor(rt, event.cwd)
  if (!layout.ok) return { kind: 'silent' }

  if (event.agent_id === null || !isSafePathSegment(event.agent_id)) return { kind: 'silent' }
  if (!isSafePathSegment(event.session_id)) return { kind: 'silent' }
  if (event.agent_type.length === 0) return { kind: 'silent' }

  if (markerExists(layout.value.state, event.session_id, event.agent_id)) return { kind: 'silent' }

  const baseline = readResumeBaseline(layout.value)
  if (baseline === null || baseline.session_id !== event.session_id) return { kind: 'silent' }

  const head = readLedgerHead(rt, layout.value.projectRoot)
  if (head === null) return { kind: 'silent' }

  const gateState = readRecordingGateState(rt, layout.value.state)
  const reference = headAtLastFireFor(gateState, event.session_id) ?? baseline.ledger_head
  if (reference === null) return { kind: 'silent' }

  if (head !== reference) return { kind: 'silent' }

  writeMarker(rt, layout.value.state, event.session_id, event.agent_id)

  return { kind: 'block', reason: subagentBlockReason() }
}
