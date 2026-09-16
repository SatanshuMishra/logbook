import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { StoreLayout } from '../store/layout.ts'
import type { ConflictState } from './conflict.ts'

const ObjectIdSchema = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/)

const ConflictStateSchema = z.strictObject({
  local_commit: ObjectIdSchema,
  remote_commit: ObjectIdSchema,
  paths: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        base_blob: ObjectIdSchema.nullable(),
        local_blob: ObjectIdSchema.nullable(),
        remote_blob: ObjectIdSchema.nullable()
      })
    )
    .min(1)
})

export type ConflictStateRead =
  | { kind: 'absent' }
  | { kind: 'present'; state: ConflictState }
  | { kind: 'unreadable'; detail: string }

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const conflictStatePath = (layout: StoreLayout): string => path.join(layout.state, 'conflicts.json')

export const writeConflictState = (layout: StoreLayout, state: ConflictState): { ok: true } | { ok: false; detail: string } => {
  try {
    mkdirSync(layout.state, { recursive: true })
    writeFileSync(conflictStatePath(layout), JSON.stringify(state), 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: describeError(error) }
  }
}

export const readConflictState = (layout: StoreLayout): ConflictStateRead => {
  let raw: string
  try {
    raw = readFileSync(conflictStatePath(layout), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    return { kind: 'unreadable', detail: describeError(error) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { kind: 'unreadable', detail: describeError(error) }
  }
  const checked = ConflictStateSchema.safeParse(parsed)
  return checked.success ? { kind: 'present', state: checked.data } : { kind: 'unreadable', detail: checked.error.message }
}

export const clearConflictState = (layout: StoreLayout): void => {
  try {
    unlinkSync(conflictStatePath(layout))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}
