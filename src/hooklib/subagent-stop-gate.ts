import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { readLedgerHead, readResumeBaseline } from './ledger-presence.ts'
import { ledgerRecordingStored } from './transcript.ts'
import type { StopVerdict } from './stop-gate.ts'

export type SubagentStopEvent = {
  session_id: string
  cwd: string
  agent_id: string | null
  agent_type: string
  agent_transcript_path: unknown
}

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

const SUBAGENT_BLOCK_REASON = [
  'Logbook: this agent has not written anything to the Logbook ledger in this run.',
  'Before returning, record what this run found, so that a later session does not have to work it out again:',
  '- each decision made, with its reason, using record_decision',
  '- each risk found, using update_thread with risks_add',
  '- what was found, what was changed, and what is still open, as one entry using log_session_event',
  "Use the thread id from this agent's instructions. If none was given, list_threads shows the open threads.",
  'If this run found nothing worth keeping, if this agent does not have the ledger tools, or if its instructions say not to write to the ledger, return as planned without writing.'
].join('\n')

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

  if (ledgerRecordingStored(event.agent_transcript_path) !== false) return { kind: 'silent' }

  writeMarker(rt, layout.value.state, event.session_id, event.agent_id)

  return { kind: 'block', reason: SUBAGENT_BLOCK_REASON }
}
