import { ulid as generateUlid } from 'ulid'
import { createStderrLogger } from './logger.ts'

export type Runtime = {
  now: () => string
  ulid: () => string
  env: Readonly<Record<string, string | undefined>>
  cwd: string
  log: (record: Record<string, unknown>) => void
  sessionId: string
}

const SESSION_ID_ENV_KEY = 'CLAUDE_CODE_SESSION_ID'

export const productionRuntime = (): Runtime => {
  const env = Object.freeze({ ...process.env })
  const log = createStderrLogger(env)
  const sessionIdFromEnv = env[SESSION_ID_ENV_KEY]
  const sessionId =
    sessionIdFromEnv !== undefined && sessionIdFromEnv.length > 0 ? sessionIdFromEnv : generateUlid()
  if (sessionIdFromEnv === undefined || sessionIdFromEnv.length === 0) {
    log({
      level: 'warn',
      event: 'runtime.session-id-fallback',
      reason: `${SESSION_ID_ENV_KEY} was not set in the environment; minted a ULID instead of the harness-supplied session id`
    })
  }
  return {
    now: () => new Date().toISOString(),
    ulid: () => generateUlid(),
    env,
    cwd: process.cwd(),
    log,
    sessionId
  }
}
