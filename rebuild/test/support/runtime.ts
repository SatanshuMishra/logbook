import type { Runtime } from '../../src/runtime/runtime.ts'

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ULID_TIME_PREFIX = '01ARZ3NDEK'
const DEFAULT_START = '2024-01-01T00:00:00.000Z'
const DEFAULT_STEP_MS = 1000

export type TestRuntimeOptions = {
  start?: string
  stepMs?: number
  env?: Readonly<Record<string, string | undefined>>
  cwd?: string
}

const encodeMonotonicSuffix = (seq: number): string => {
  let value = seq
  const chars: string[] = []
  for (let i = 0; i < 16; i += 1) {
    chars.unshift(CROCKFORD_ALPHABET[value % 32] as string)
    value = Math.floor(value / 32)
  }
  return chars.join('')
}

export const testRuntime = (opts: TestRuntimeOptions = {}): Runtime => {
  const startMs = opts.start !== undefined ? Date.parse(opts.start) : Date.parse(DEFAULT_START)
  const stepMs = opts.stepMs ?? DEFAULT_STEP_MS
  const env = Object.freeze({ ...(opts.env ?? {}) })
  let tick = 0
  let ulidSeq = 0
  const now = (): string => {
    const value = new Date(startMs + tick * stepMs).toISOString()
    tick += 1
    return value
  }
  const ulid = (): string => {
    const suffix = encodeMonotonicSuffix(ulidSeq)
    ulidSeq += 1
    return `${ULID_TIME_PREFIX}${suffix}`
  }
  return {
    now,
    ulid,
    env,
    cwd: opts.cwd ?? '/test-cwd',
    log: () => {}
  }
}
