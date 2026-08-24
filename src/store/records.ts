import { readdirSync } from 'node:fs'
import path from 'node:path'
import type { Ok, Refusal } from '../schema/declare.ts'
import { DecisionRecord, type Decision } from '../schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../schema/session.ts'
import { ThreadRecord, type Thread, type Ulid } from '../schema/thread.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { errnoCode, withDetail } from './detail.ts'
import { createStoreDirectories, layoutFor, type StoreLayout } from './layout.ts'
import { markSynced, readAllRecordFiles, readRecordFile, syncWorkingCopy } from './read-path.ts'
import { ensureSingleStore } from './single-store.ts'
import { writeRecords } from './write-path.ts'
import type { Loaded, Quarantined, Slot } from './read-path.ts'
import type { CommitResult, RecordChange } from './write-path.ts'

export type { Loaded, Quarantined, Slot } from './read-path.ts'
export type { CommitResult, RecordChange } from './write-path.ts'
export type { Decision } from '../schema/decision.ts'
export type { SessionEntry } from '../schema/session.ts'
export type { Thread, Ulid } from '../schema/thread.ts'

export type Store = {
  readThread: (id: Ulid) => Slot<Thread> | null
  readThreads: () => Slot<Thread>[]
  readDecision: (id: Ulid) => Slot<Decision> | null
  readSessionEntry: (threadId: Ulid, entryId: Ulid) => Slot<SessionEntry> | null
  readSessionEntries: (threadId: Ulid) => Slot<SessionEntry>[]
  commit: (changes: RecordChange[], message: string) => CommitResult
}

const validateChange = (change: RecordChange): Refusal | null => {
  if (change.kind === 'raw') return null
  if (change.kind === 'thread') {
    const validated = ThreadRecord.parse(change.record)
    return validated.ok ? null : validated
  }
  if (change.kind === 'decision') {
    const validated = DecisionRecord.parse(change.record)
    return validated.ok ? null : validated
  }
  const validated = SessionRecord.parse(change.record)
  return validated.ok ? null : validated
}

const invalidChangeResult = (refusal: Refusal): CommitResult => ({
  ok: false,
  reason: 'invalid',
  detail: `${refusal.field} failed its stored-shape validation: ${refusal.message}`
})

const threadPath = (layout: StoreLayout, id: Ulid): string => path.join(layout.records, 'threads', `${id}.json`)
const decisionPath = (layout: StoreLayout, id: Ulid): string =>
  path.join(layout.records, 'decisions', `${id}.json`)
const sessionEntryPath = (layout: StoreLayout, threadId: Ulid, entryId: Ulid): string =>
  path.join(layout.records, 'sessions', threadId, `${entryId}.json`)

const checkRecordsReadable = (rt: Runtime, layout: StoreLayout): Refusal | null => {
  try {
    readdirSync(layout.records)
    return null
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const code = errnoCode(error)
    rt.log({ level: 'error', event: 'store.records-directory-unreadable', code, detail })
    return withDetail(
      {
        ok: false,
        field: 'records',
        accepted: 'a readable records directory',
        example: 'chmod +r <records-directory>',
        retryable: true,
        message: `the store's records directory could not be read: ${code}`
      },
      detail
    )
  }
}

export const openStore = (rt: Runtime, projectRoot: string): Ok<Store> | Refusal => {
  const layout = layoutFor(rt, projectRoot)
  if (!layout.ok) return layout

  const ensured = ensureSingleStore(rt, layout.value)
  if (!ensured.ok) return ensured

  createStoreDirectories(ensured.value)

  const storeLayout = ensured.value

  const readableRefusal = checkRecordsReadable(rt, storeLayout)
  if (readableRefusal !== null) return readableRefusal

  syncWorkingCopy(rt, storeLayout)

  const store: Store = {
    readThread: (id) => readRecordFile<Thread>(threadPath(storeLayout, id), ThreadRecord),
    readThreads: () => readAllRecordFiles<Thread>(path.join(storeLayout.records, 'threads'), ThreadRecord),
    readDecision: (id) => readRecordFile<Decision>(decisionPath(storeLayout, id), DecisionRecord),
    readSessionEntry: (threadId, entryId) =>
      readRecordFile<SessionEntry>(sessionEntryPath(storeLayout, threadId, entryId), SessionRecord),
    readSessionEntries: (threadId) =>
      readAllRecordFiles<SessionEntry>(path.join(storeLayout.records, 'sessions', threadId), SessionRecord),
    commit: (changes, message) => {
      for (const change of changes) {
        const refusal = validateChange(change)
        if (refusal !== null) {
          return invalidChangeResult(refusal)
        }
      }
      const result = writeRecords(rt, storeLayout, changes, message)
      if (result.ok) {
        markSynced(storeLayout, result.after)
      }
      return result
    }
  }

  return { ok: true, value: store }
}
