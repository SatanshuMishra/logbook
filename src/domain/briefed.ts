import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { ULID_PATTERN } from '../schema/ids.ts'

const BRIEFED_FILE_NAME = 'briefed.json'

export const BRIEFED_THREADS_MAX = 100

type StoredBriefedShape = { session_id: string; thread_ids: string[] }

const briefedPathFor = (root: StoreLayout): string => path.join(root.state, BRIEFED_FILE_NAME)

const isValidBriefedShape = (value: unknown): value is StoredBriefedShape => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.session_id !== 'string' || candidate.session_id.length === 0) return false
  if (!Array.isArray(candidate.thread_ids)) return false
  return candidate.thread_ids.every((entry) => typeof entry === 'string' && ULID_PATTERN.test(entry))
}

export const readBriefed = (rt: Runtime, root: StoreLayout): readonly string[] => {
  const target = briefedPathFor(root)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    rt.log({
      level: 'warn',
      event: 'briefed.unreadable',
      path: target,
      detail: error instanceof Error ? error.message : String(error)
    })
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    rt.log({ level: 'warn', event: 'briefed.unparseable', path: target, detail: (error as Error).message })
    return []
  }

  if (!isValidBriefedShape(parsed)) {
    rt.log({ level: 'warn', event: 'briefed.invalid-shape', path: target })
    return []
  }

  return parsed.session_id === rt.sessionId ? parsed.thread_ids : []
}

export const recordBriefed = (rt: Runtime, root: StoreLayout, threadId: string): void => {
  const known = readBriefed(rt, root)
  const next = known.includes(threadId) ? known : [...known, threadId]
  const capped = next.slice(Math.max(0, next.length - BRIEFED_THREADS_MAX))
  mkdirSync(root.state, { recursive: true })
  durableWrite(briefedPathFor(root), JSON.stringify({ session_id: rt.sessionId, thread_ids: capped }), {
    log: rt.log
  })
}
