import { ulid as generateUlid } from 'ulid'
import { createStderrLogger } from './logger.ts'
import { PROJECT_DIR_ENV_KEY, RUN_WRITER_PREFIX } from '../thread/paths.ts'

export type Writer = { kind: 'session' | 'command'; name: string }

export type Runtime = {
  now: () => string
  ulid: () => string
  env: Readonly<Record<string, string | undefined>>
  cwd: string | null
  log: (record: Record<string, unknown>) => void
  sessionId: string
  writer: Writer
  parentProcess: number | null
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
  let cwd: string | null
  try {
    cwd = process.cwd()
  } catch (error) {
    cwd = null
    log({
      level: 'warn',
      event: 'runtime.cwd-unreadable',
      reason: `the process could not read its own working directory: ${error instanceof Error ? error.message : String(error)}`
    })
  }
  return {
    now: () => new Date().toISOString(),
    ulid: () => generateUlid(),
    env,
    cwd,
    log,
    sessionId,
    writer: { kind: 'session', name: sessionId },
    parentProcess: process.ppid
  }
}

export type CommandRuntimeInput = { repo: string; writer?: string }

const DECISIONS_READER = 'decisions'

export const actsAsSession = (rt: Runtime): boolean => rt.writer.name === rt.sessionId

export const commandRuntime = (input: CommandRuntimeInput): Runtime => {
  const env = Object.freeze({ ...process.env, [PROJECT_DIR_ENV_KEY]: input.repo })
  const writerName = input.writer ?? DECISIONS_READER
  const sessionId =
    input.writer === undefined || input.writer.startsWith(RUN_WRITER_PREFIX) ? generateUlid() : input.writer
  return {
    now: () => new Date().toISOString(),
    ulid: () => generateUlid(),
    env,
    cwd: input.repo,
    log: createStderrLogger(env),
    sessionId,
    writer: { kind: 'command', name: writerName },
    parentProcess: process.ppid
  }
}
