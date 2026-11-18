import type { Runtime } from '../runtime/runtime.ts'
import { findRepository, startDirectory, type RepoPaths } from '../thread/paths.ts'

export type HookInput = { event: Record<string, unknown>; sessionId: string; paths: RepoPaths; rt: Runtime }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

export const sessionRuntime = (base: Runtime, sessionId: string): Runtime => ({
  ...base,
  env: { ...base.env, CLAUDE_CODE_SESSION_ID: sessionId },
  sessionId,
  writer: { kind: 'session', name: sessionId }
})

export const hookInputFor = (baseRuntime: () => Runtime, parsed: unknown): HookInput | null => {
  if (!isRecord(parsed)) return null
  const sessionId = nonEmptyString(parsed.session_id)
  const cwd = nonEmptyString(parsed.cwd)
  if (sessionId === null || cwd === null) return null
  const rt = sessionRuntime(baseRuntime(), sessionId)
  const found = findRepository(rt, startDirectory(rt, cwd))
  if (!found.ok) return null
  return { event: parsed, sessionId, paths: found.value, rt }
}
