import { mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { ULID_PATTERN, ISO_PATTERN } from '../schema/ids.ts'
import type { Ulid, Iso8601 } from '../schema/thread.ts'

export type Pointer = { thread_id: Ulid; written_at: Iso8601; session_id: string }

export type PointerRead = { kind: 'absent' } | { kind: 'pointer'; value: Pointer } | { kind: 'corrupt'; reason: string }

export type ReleaseOutcome = 'released' | 'not-owned' | 'already-clear'

const POINTER_FILE_NAME = 'active-thread.json'

const pointerPathFor = (root: StoreLayout): string => path.join(root.state, POINTER_FILE_NAME)

type StoredPointerShape = { thread_id: string; written_at: string; session_id: string }

const isValidPointerShape = (value: unknown): value is StoredPointerShape => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.thread_id !== 'string' || !ULID_PATTERN.test(candidate.thread_id)) return false
  if (typeof candidate.written_at !== 'string' || !ISO_PATTERN.test(candidate.written_at)) return false
  if (typeof candidate.session_id !== 'string' || candidate.session_id.length === 0) return false
  return true
}

export const readPointer = (rt: Runtime, root: StoreLayout): PointerRead => {
  const target = pointerPathFor(root)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    throw new Error(`readPointer: failed to read ${target}: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    rt.log({ level: 'error', event: 'pointer.unparseable', path: target, detail: (error as Error).message })
    return { kind: 'corrupt', reason: 'the pointer file exists but does not parse as JSON' }
  }

  if (!isValidPointerShape(parsed)) {
    rt.log({ level: 'error', event: 'pointer.invalid-shape', path: target })
    return { kind: 'corrupt', reason: 'the pointer file exists but does not match the pointer shape' }
  }

  return {
    kind: 'pointer',
    value: {
      thread_id: parsed.thread_id,
      written_at: parsed.written_at,
      session_id: parsed.session_id
    }
  }
}

export const writePointer = (rt: Runtime, root: StoreLayout, p: Pointer): void => {
  mkdirSync(root.state, { recursive: true })
  const target = pointerPathFor(root)
  const contents = JSON.stringify({
    thread_id: p.thread_id,
    written_at: p.written_at,
    session_id: p.session_id
  })
  durableWrite(target, contents, { log: rt.log })
}

export const releasePointer = (rt: Runtime, root: StoreLayout): void => {
  const target = pointerPathFor(root)
  try {
    unlinkSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`releasePointer: failed to remove ${target}: ${(error as Error).message}`)
    }
  }
}

export const releasePointerIfOwned = (rt: Runtime, root: StoreLayout, thread_id: Ulid): ReleaseOutcome => {
  const current = readPointer(rt, root)
  if (current.kind !== 'pointer') return 'already-clear'
  if (current.value.thread_id !== thread_id) return 'not-owned'
  releasePointer(rt, root)
  return 'released'
}
