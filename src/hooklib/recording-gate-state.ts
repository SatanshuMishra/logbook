import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { durableWrite } from '../store/durable-write.ts'
import { SHA_PATTERN } from '../schema/ids.ts'

const RECORDING_GATE_FILE_NAME = 'recording-gate.json'

export type ThreadFireState = { head_at_last_fire: string; fires: number; prompt_id_at_last_fire: string | null }
export type RecordingGateState = {
  session_id: string
  threads: Record<string, ThreadFireState>
  head_at_last_fire: string | null
}

const recordingGatePathFor = (stateDir: string): string => path.join(stateDir, RECORDING_GATE_FILE_NAME)

const isThreadFireState = (value: unknown): value is ThreadFireState => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.head_at_last_fire !== 'string' || !SHA_PATTERN.test(candidate.head_at_last_fire)) return false
  if (typeof candidate.fires !== 'number' || !Number.isInteger(candidate.fires) || candidate.fires < 0) return false
  if (candidate.prompt_id_at_last_fire !== null && typeof candidate.prompt_id_at_last_fire !== 'string') return false
  return true
}

const parseThreads = (value: unknown): Record<string, ThreadFireState> | null => {
  if (typeof value !== 'object' || value === null) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.every(([, candidate]) => isThreadFireState(candidate))) return null
  return Object.fromEntries(entries as Array<[string, ThreadFireState]>)
}

const parseHeadAtLastFire = (value: unknown): string | null => {
  if (value === null) return null
  if (typeof value === 'string' && SHA_PATTERN.test(value)) return value
  return null
}

export const readRecordingGateState = (rt: Runtime, stateDir: string): RecordingGateState | null => {
  let raw: string
  try {
    raw = readFileSync(recordingGatePathFor(stateDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    rt.log({
      level: 'warn',
      event: 'stop-gate.recording-gate-state-unreadable',
      detail: error instanceof Error ? error.message : String(error)
    })
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    rt.log({
      level: 'warn',
      event: 'stop-gate.recording-gate-state-unparseable',
      detail: error instanceof Error ? error.message : String(error)
    })
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.session_id !== 'string' || candidate.session_id.length === 0) return null
  const threads = parseThreads(candidate.threads)
  if (threads === null) return null
  return {
    session_id: candidate.session_id,
    threads,
    head_at_last_fire: parseHeadAtLastFire(candidate.head_at_last_fire)
  }
}

export const writeRecordingGateState = (rt: Runtime, stateDir: string, state: RecordingGateState): void => {
  durableWrite(recordingGatePathFor(stateDir), JSON.stringify(state), { log: rt.log })
}
