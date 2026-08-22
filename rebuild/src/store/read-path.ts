import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Declared } from '../schema/declare.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { git } from './git.ts'
import type { StoreLayout } from './layout.ts'
import { LEDGER_REF } from './ref.ts'

export type Quarantined = { quarantined: true; path: string; reason: string }
export type Loaded<T> = { quarantined: false; record: T }
export type Slot<T> = Loaded<T> | Quarantined

let subprocessCallCount = 0
let materialiseCallCount = 0

export const resetSubprocessCallCounter = (): void => {
  subprocessCallCount = 0
}

export const getSubprocessCallCounter = (): number => subprocessCallCount

export const resetMaterialiseCallCounter = (): void => {
  materialiseCallCount = 0
}

export const getMaterialiseCallCounter = (): number => materialiseCallCount

const countedGit: typeof git = (rt, repo, args, opts) => {
  subprocessCallCount += 1
  return git(rt, repo, args, opts)
}

const countedMaterialiseGit: typeof git = (rt, repo, args, opts) => {
  materialiseCallCount += 1
  return git(rt, repo, args, opts)
}

const lastSyncedPath = (layout: StoreLayout): string => path.join(layout.state, 'last-synced')

const readLastSynced = (layout: StoreLayout): string | null => {
  try {
    return readFileSync(lastSyncedPath(layout), 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const writeLastSynced = (layout: StoreLayout, value: string): void => {
  writeFileSync(lastSyncedPath(layout), value, 'utf8')
}

export const markSynced = (layout: StoreLayout, ref: string): void => {
  writeLastSynced(layout, ref)
}

const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {
  const tabIndex = line.indexOf('\t')
  if (tabIndex === -1) return null
  const meta = line.slice(0, tabIndex).split(' ')
  const blobId = meta[2]
  if (blobId === undefined) return null
  return { blobId, relPath: line.slice(tabIndex + 1) }
}

const materialiseTree = (rt: Runtime, layout: StoreLayout, ref: string): void => {
  const list = countedMaterialiseGit(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!list.ok) return

  rmSync(layout.records, { recursive: true, force: true })
  mkdirSync(layout.records, { recursive: true })

  const lines = list.stdout.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
    const content = countedMaterialiseGit(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
    if (!content.ok) continue
    const target = path.join(layout.records, parsed.relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.stdout, 'utf8')
  }
}

export const syncWorkingCopy = (rt: Runtime, layout: StoreLayout, runGit: typeof git = countedGit): void => {
  const current = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
  const currentValue = current.ok ? current.stdout.trim() : null
  const cached = readLastSynced(layout)

  if (currentValue === cached) return

  if (currentValue === null) {
    writeLastSynced(layout, '')
    return
  }

  materialiseTree(rt, layout, currentValue)
  writeLastSynced(layout, currentValue)
}

export const readRecordFile = <T>(filePath: string, declared: Declared<T>): Slot<T> | null => {
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
