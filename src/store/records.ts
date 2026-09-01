import { opendirSync, readdirSync, type Dir } from 'node:fs'
import path from 'node:path'
import type { Ok, Refusal } from '../schema/declare.ts'
import { DecisionRecord, type Decision } from '../schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../schema/session.ts'
import { ThreadRecord, type Thread, type Ulid } from '../schema/thread.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { errnoCode, withDetail } from './detail.ts'
import { git } from './git.ts'
import { createStoreDirectories, layoutFor, type StoreLayout } from './layout.ts'
import { markMaterialised, readAllRecordFiles, readRecordFile, readRecordVerdict, syncWorkingCopy } from './read-path.ts'
import { LEDGER_REF } from './ref.ts'
import { ensureSingleStore } from './single-store.ts'
import { writeRecords } from './write-path.ts'
import type { Loaded, Quarantined, Slot } from './read-path.ts'
import type { CommitResult, RecordChange } from './write-path.ts'

export type { Loaded, Quarantined, Slot } from './read-path.ts'
export type { CommitResult, RecordChange } from './write-path.ts'
export type { Decision } from '../schema/decision.ts'
export type { SessionEntry } from '../schema/session.ts'
export type { Thread, Ulid } from '../schema/thread.ts'

export type DecisionProbe = { resolved: number; dangling: Ulid[]; quarantined: Ulid[] }

export type Store = {
  readThread: (id: Ulid) => Slot<Thread> | null
  readThreads: () => Slot<Thread>[]
  readDecision: (id: Ulid) => Slot<Decision> | null
  readSessionEntry: (threadId: Ulid, entryId: Ulid) => Slot<SessionEntry> | null
  readSessionEntries: (threadId: Ulid) => Slot<SessionEntry>[]
  probeDecisions: (ids: readonly Ulid[]) => DecisionProbe
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
const decisionsDir = (layout: StoreLayout): string => path.join(layout.records, 'decisions')
const decisionPath = (layout: StoreLayout, id: Ulid): string => path.join(decisionsDir(layout), `${id}.json`)
const sessionEntryPath = (layout: StoreLayout, threadId: Ulid, entryId: Ulid): string =>
  path.join(layout.records, 'sessions', threadId, `${entryId}.json`)

type PresentDecisionIds = { listed: true; ids: Set<string> } | { listed: false }

const presentDecisionIds = (layout: StoreLayout): PresentDecisionIds => {
  try {
    const names = readdirSync(decisionsDir(layout)).filter((name) => name.endsWith('.json'))
    return { listed: true, ids: new Set(names.map((name) => name.slice(0, -'.json'.length))) }
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { listed: true, ids: new Set() }
    return { listed: false }
  }
}

const probeDecisionIdsByVerdict = (layout: StoreLayout, ids: readonly Ulid[]): DecisionProbe => {
  const dangling: Ulid[] = []
  const quarantined: Ulid[] = []
  for (const id of ids) {
    const verdict = readRecordVerdict<Decision>(decisionPath(layout, id), DecisionRecord)
    if (verdict === 'quarantined') quarantined.push(id)
    else if (verdict === 'absent') dangling.push(id)
  }
  return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
}

const probeDecisionIds = (layout: StoreLayout, ids: readonly Ulid[]): DecisionProbe => {
  const present = presentDecisionIds(layout)
  if (!present.listed) return probeDecisionIdsByVerdict(layout, ids)

  const dangling: Ulid[] = []
  const quarantined: Ulid[] = []
  for (const id of ids) {
    if (!present.ids.has(id)) {
      dangling.push(id)
      continue
    }
    const verdict = readRecordVerdict<Decision>(decisionPath(layout, id), DecisionRecord)
    if (verdict === 'quarantined') quarantined.push(id)
    else if (verdict === 'absent') dangling.push(id)
  }
  return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
}

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

let recordScanCount = 0

export const resetRecordScanCounter = (): void => {
  recordScanCount = 0
}

export const getRecordScanCounter = (): number => recordScanCount

const openDirOrNull = (dir: string): Dir | null => {
  try {
    return opendirSync(dir)
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
}

const holdsAnyRecord = (dir: string): boolean => {
  const handle = openDirOrNull(dir)
  if (handle === null) return false
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      recordScanCount += 1
      if (entry.isFile() && entry.name.endsWith('.json')) return true
      if (entry.isDirectory() && holdsAnyRecord(path.join(dir, entry.name))) return true
    }
    return false
  } finally {
    handle.closeSync()
  }
}

const refRecordCount = (rt: Runtime, layout: StoreLayout): number | null => {
  const listing = git(rt, layout.projectRoot, ['ls-tree', '-r', '--name-only', LEDGER_REF])
  if (!listing.ok) return null
  return listing.stdout.split('\n').filter((line) => line.length > 0).length
}

const materialisationRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'records',
      accepted: 'a records directory materialised from the ledger ref',
      example: 'git rev-parse refs/logbook/ledger',
      retryable: true,
      message: 'the ledger ref holds records this store did not materialise; the store was not opened'
    },
    detail
  )

const ensureMaterialised = (rt: Runtime, layout: StoreLayout): Ok<void> | Refusal => {
  const outcome = syncWorkingCopy(rt, layout)
  if (!outcome.ok) return materialisationRefusal(outcome.detail)

  if (outcome.materialised) return { ok: true, value: undefined }

  if (holdsAnyRecord(layout.records)) return { ok: true, value: undefined }

  const inRef = refRecordCount(rt, layout)
  if (inRef === null || inRef === 0) return { ok: true, value: undefined }

  rt.log({
    level: 'error',
    event: 'store.materialisation-anomaly',
    records_in_ref: inRef,
    records_on_disk: 0,
    detail: 'the ledger ref holds records this store has not materialised'
  })

  return { ok: true, value: undefined }
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

  const materialisation = ensureMaterialised(rt, storeLayout)
  if (!materialisation.ok) return materialisation

  const store: Store = {
    readThread: (id) => readRecordFile<Thread>(threadPath(storeLayout, id), ThreadRecord),
    readThreads: () => readAllRecordFiles<Thread>(path.join(storeLayout.records, 'threads'), ThreadRecord),
    readDecision: (id) => readRecordFile<Decision>(decisionPath(storeLayout, id), DecisionRecord),
    readSessionEntry: (threadId, entryId) =>
      readRecordFile<SessionEntry>(sessionEntryPath(storeLayout, threadId, entryId), SessionRecord),
    readSessionEntries: (threadId) =>
      readAllRecordFiles<SessionEntry>(path.join(storeLayout.records, 'sessions', threadId), SessionRecord),
    probeDecisions: (ids) => probeDecisionIds(storeLayout, ids),
    commit: (changes, message) => {
      for (const change of changes) {
        const refusal = validateChange(change)
        if (refusal !== null) {
          return invalidChangeResult(refusal)
        }
      }
      const result = writeRecords(rt, storeLayout, changes, message)
      if (result.ok) {
        markMaterialised(storeLayout, result.after)
      }
      return result
    }
  }

  return { ok: true, value: store }
}
