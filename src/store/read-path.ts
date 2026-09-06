import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Declared } from '../schema/declare.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { describeError } from './detail.ts'
import { durableWrite } from './durable-write.ts'
import { git, gitBuffer } from './git.ts'
import type { StoreLayout } from './layout.ts'
import {
  pruneRecordsAbsentFromRef,
  refuseSymlinkedRecordsDirectory,
  verifyMaterialisedNamesRoundTrip,
  type MaterialiseFailureCause,
  type MaterialiseOutcome
} from './materialise-in-place.ts'
import { listMaterialisableEntries, writeMaterialisedEntries } from './materialise-tree.ts'
import { LEDGER_REF } from './ref.ts'

export type { MaterialiseFailureCause, MaterialiseOutcome } from './materialise-in-place.ts'

export type Quarantined = { quarantined: true; path: string; reason: string }
export type Loaded<T> = { quarantined: false; record: T }
export type Slot<T> = Loaded<T> | Quarantined

let subprocessCallCount = 0
let materialiseCallCount = 0
let recordReadCount = 0

export const resetSubprocessCallCounter = (): void => {
  subprocessCallCount = 0
}

export const getSubprocessCallCounter = (): number => subprocessCallCount

export const resetMaterialiseCallCounter = (): void => {
  materialiseCallCount = 0
}

export const getMaterialiseCallCounter = (): number => materialiseCallCount

export const resetRecordReadCounter = (): void => {
  recordReadCount = 0
}

export const getRecordReadCounter = (): number => recordReadCount

const countedGit: typeof git = (rt, repo, args, opts) => {
  subprocessCallCount += 1
  return git(rt, repo, args, opts)
}

export const countedMaterialiseGit: typeof git = (rt, repo, args, opts) => {
  materialiseCallCount += 1
  return git(rt, repo, args, opts)
}

export const countedMaterialiseGitBuffer: typeof gitBuffer = (rt, repo, args, opts) => {
  materialiseCallCount += 1
  return gitBuffer(rt, repo, args, opts)
}

const STAMP_FILE_NAME = 'last-materialised'
const LEGACY_STAMP_FILE_NAME = 'last-synced'

const stampPath = (layout: StoreLayout): string => path.join(layout.state, STAMP_FILE_NAME)

const legacyStampPath = (layout: StoreLayout): string => path.join(layout.state, LEGACY_STAMP_FILE_NAME)

const readStampFile = (target: string): string | null => {
  try {
    return readFileSync(target, 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const readStamp = (layout: StoreLayout): string | null => {
  const current = readStampFile(stampPath(layout))
  if (current !== null) return current
  return readStampFile(legacyStampPath(layout))
}

const writeStamp = (layout: StoreLayout, value: string): void => {
  writeFileSync(stampPath(layout), value, 'utf8')
}

const normaliseStampForComparison = (stamp: string | null): string => stamp ?? ''

export type AdvanceStampOutcome =
  | { advanced: true }
  | { advanced: false; reason: 'stamp-mismatch'; observed: string | null }
  | { advanced: false; reason: 'io-error' }

export const advanceMaterialisedStampIfStillCurrent = (
  rt: Runtime,
  layout: StoreLayout,
  before: string | null,
  after: string
): AdvanceStampOutcome => {
  let stamp: string | null
  try {
    stamp = readStamp(layout)
  } catch (error) {
    rt.log({
      level: 'error',
      event: 'store.materialised-stamp-advance-failed',
      before,
      after,
      detail: describeError(error)
    })
    return { advanced: false, reason: 'io-error' }
  }

  if (normaliseStampForComparison(stamp) !== normaliseStampForComparison(before)) {
    return { advanced: false, reason: 'stamp-mismatch', observed: stamp }
  }

  try {
    writeStamp(layout, after)
  } catch (error) {
    rt.log({
      level: 'error',
      event: 'store.materialised-stamp-advance-failed',
      before,
      after,
      detail: describeError(error)
    })
    return { advanced: false, reason: 'io-error' }
  }

  return { advanced: true }
}

export const discardScratchDir = (rt: Runtime, dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (error) {
    rt.log({
      level: 'error',
      event: 'store.materialise-scratch-cleanup-failed',
      dir,
      detail: describeError(error)
    })
  }
}

const readLedgerRefForPrune = (rt: Runtime, layout: StoreLayout): string | null => {
  const result = countedMaterialiseGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
  return result.ok ? result.stdout.trim() : null
}

const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseOutcome => {
  const realDirectory = refuseSymlinkedRecordsDirectory(layout.records)
  if (!realDirectory.ok) return realDirectory

  const planned = listMaterialisableEntries(rt, layout.projectRoot, ref, layout.records, {
    runGit: countedMaterialiseGit
  })
  if (!planned.ok) return { ok: false, cause: 'materialisation', detail: planned.detail }

  const pruned = pruneRecordsAbsentFromRef(rt, layout.records, ref, planned.plan.relPaths, () =>
    readLedgerRefForPrune(rt, layout)
  )
  if (!pruned.ok) return pruned

  const written = writeMaterialisedEntries(rt, layout.projectRoot, ref, planned.plan, {
    runGitBuffer: countedMaterialiseGitBuffer,
    write: (target, contents) => {
      durableWrite(target, contents, { log: rt.log })
    }
  })
  if (!written.ok) return { ok: false, cause: 'materialisation', detail: written.detail }

  return verifyMaterialisedNamesRoundTrip(layout.records, ref, planned.plan.relPaths)
}

export type SyncWorkingCopyOutcome =
  | { ok: true; materialised: boolean; ref: string | null }
  | { ok: false; cause: MaterialiseFailureCause; detail: string }

export const syncWorkingCopy = (
  rt: Runtime,
  layout: StoreLayout,
  runGit: typeof git = countedGit
): SyncWorkingCopyOutcome => {
  const current = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
  const currentValue = current.ok ? current.stdout.trim() : null
  const cached = readStamp(layout)

  if (currentValue === cached) return { ok: true, materialised: false, ref: currentValue }

  if (currentValue === null) {
    writeStamp(layout, '')
    return { ok: true, materialised: false, ref: currentValue }
  }

  const outcome = materialiseTree(rt, layout, currentValue)
  if (!outcome.ok) {
    rt.log({ level: 'error', event: 'store.materialisation-failed', ref: currentValue, detail: outcome.detail })
    return outcome
  }

  writeStamp(layout, currentValue)
  return { ok: true, materialised: true, ref: currentValue }
}

export const readRecordFile = <T>(filePath: string, declared: Declared<T>): Slot<T> | null => {
  recordReadCount += 1
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch (error) {
    return { quarantined: true, path: filePath, reason: `invalid JSON: ${(error as Error).message}` }
  }

  const result = declared.parse(parsedJson)
  if (!result.ok) {
    return { quarantined: true, path: filePath, reason: result.message }
  }
  return { quarantined: false, record: result.value }
}

export type RecordVerdict = 'absent' | 'valid' | 'quarantined'

export const readRecordVerdict = <T>(filePath: string, declared: Declared<T>): RecordVerdict => {
  const slot = readRecordFile<T>(filePath, declared)
  if (slot === null) return 'absent'
  return slot.quarantined ? 'quarantined' : 'valid'
}

export const readAllRecordFiles = <T>(dir: string, declared: Declared<T>): Slot<T>[] => {
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const slots: Slot<T>[] = []
  for (const name of [...names].sort()) {
    const slot = readRecordFile<T>(path.join(dir, name), declared)
    if (slot !== null) slots.push(slot)
  }
  return slots
}
