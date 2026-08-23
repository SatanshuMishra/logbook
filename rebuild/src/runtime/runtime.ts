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

export const productionRuntime = (): Runtime => {
  const env = Object.freeze({ ...process.env })
  return {
    now: () => new Date().toISOString(),
    ulid: () => generateUlid(),
    env,
    cwd: process.cwd(),
    log: createStderrLogger(env),
    sessionId: generateUlid()
  }
}
