import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { ThreadRecord, type Thread, type Ulid } from '../schema/thread.ts'
import { SHA_PATTERN, ULID_PATTERN } from '../schema/ids.ts'
import type { StoreLayout } from './layout.ts'
import { durableWrite } from './durable-write.ts'
import { readRecordFile, type Quarantined } from './read-path.ts'
import type { RecordChange } from './write-path.ts'

export type ResumableRead = { resumable: Thread[]; terminal: number; quarantined: Quarantined[] }

const RESUMABLE_CACHE_FILE_NAME = 'resumable.json'
const JSON_SUFFIX = '.json'
const TERMINAL_STATUSES = new Set<Thread['status']>(['done', 'abandoned'])

const resumableCachePathFor = (layout: StoreLayout): string => path.join(layout.state, RESUMABLE_CACHE_FILE_NAME)

type ResumableCache = { ref: string; terminal_ids: Ulid[] }

type CacheRead = { kind: 'absent' } | { kind: 'cache'; value: ResumableCache } | { kind: 'corrupt'; reason: string }

const isUlidArray = (value: unknown): value is Ulid[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && ULID_PATTERN.test(entry))

const isValidResumableCacheShape = (value: unknown): value is ResumableCache => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.ref !== 'string' || !SHA_PATTERN.test(candidate.ref)) return false
  if (!('terminal_ids' in candidate) || !isUlidArray(candidate.terminal_ids)) return false
  return true
}

const readResumableCache = (rt: Runtime, layout: StoreLayout): CacheRead => {
  const target = resumableCachePathFor(layout)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    throw new Error(`readResumableCache: failed to read ${target}: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    rt.log({ level: 'error', event: 'resumable.cache-unparseable', path: target, detail: (error as Error).message })
    return { kind: 'corrupt', reason: 'the resumable cache exists but does not parse as JSON' }
  }

  if (!isValidResumableCacheShape(parsed)) {
    rt.log({ level: 'error', event: 'resumable.cache-invalid-shape', path: target })
    return { kind: 'corrupt', reason: 'the resumable cache exists but does not match the resumable-cache shape' }
  }

  return { kind: 'cache', value: { ref: parsed.ref, terminal_ids: parsed.terminal_ids } }
}

const writeResumableCache = (rt: Runtime, layout: StoreLayout, cache: ResumableCache): void => {
  durableWrite(resumableCachePathFor(layout), JSON.stringify(cache), { log: rt.log })
}

const threadsDirFor = (layout: StoreLayout): string => path.join(layout.records, 'threads')

const threadPathFor = (layout: StoreLayout, id: string): string => path.join(threadsDirFor(layout), `${id}${JSON_SUFFIX}`)

const listThreadIds = (layout: StoreLayout): string[] => {
  let names: string[]
  try {
    names = readdirSync(threadsDirFor(layout))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names
    .filter((name) => name.endsWith(JSON_SUFFIX))
    .sort()
    .map((name) => name.slice(0, -JSON_SUFFIX.length))
}

const cacheIsValid = (cache: ResumableCache, currentRef: string | null, idsOnDisk: ReadonlySet<string>): boolean =>
  currentRef !== null && cache.ref === currentRef && cache.terminal_ids.every((id) => idsOnDisk.has(id))

const readNonTerminal = (
  layout: StoreLayout,
  ids: readonly string[]
): { resumable: Thread[]; quarantined: Quarantined[] } => {
  const resumable: Thread[] = []
  const quarantined: Quarantined[] = []
  for (const id of ids) {
    const slot = readRecordFile<Thread>(threadPathFor(layout, id), ThreadRecord)
    if (slot === null) continue
    if (slot.quarantined) {
      quarantined.push(slot)
      continue
    }
    resumable.push(slot.record)
  }
  return { resumable, quarantined }
}

const rebuildFromDisk = (
  layout: StoreLayout,
  ids: readonly string[]
): { resumable: Thread[]; quarantined: Quarantined[]; terminalIds: Ulid[] } => {
  const resumable: Thread[] = []
  const quarantined: Quarantined[] = []
  const terminalIds: Ulid[] = []
  for (const id of ids) {
    const slot = readRecordFile<Thread>(threadPathFor(layout, id), ThreadRecord)
    if (slot === null) continue
    if (slot.quarantined) {
      quarantined.push(slot)
      continue
    }
    if (TERMINAL_STATUSES.has(slot.record.status)) {
      terminalIds.push(slot.record.id)
      continue
    }
    resumable.push(slot.record)
  }
  return { resumable, quarantined, terminalIds }
}

export const readResumable = (rt: Runtime, layout: StoreLayout, currentRef: string | null): ResumableRead => {
  const ids = listThreadIds(layout)
  const idsOnDisk = new Set(ids)
  const cacheRead = readResumableCache(rt, layout)

  if (cacheRead.kind === 'cache' && cacheIsValid(cacheRead.value, currentRef, idsOnDisk)) {
    const skip = new Set(cacheRead.value.terminal_ids)
    const idsToRead = ids.filter((id) => !skip.has(id))
    const read = readNonTerminal(layout, idsToRead)
    return { resumable: read.resumable, terminal: cacheRead.value.terminal_ids.length, quarantined: read.quarantined }
  }

  const rebuilt = rebuildFromDisk(layout, ids)
  if (currentRef !== null) {
    writeResumableCache(rt, layout, { ref: currentRef, terminal_ids: rebuilt.terminalIds })
  }
  return { resumable: rebuilt.resumable, terminal: rebuilt.terminalIds.length, quarantined: rebuilt.quarantined }
}

export const maintainResumableCacheAfterCommit = (
  rt: Runtime,
  layout: StoreLayout,
  before: string | null,
  after: string,
  changes: readonly RecordChange[]
): void => {
  const newlyTerminal = changes.flatMap((change) =>
    change.kind === 'thread' && TERMINAL_STATUSES.has(change.record.status) ? [change.record.id] : []
  )

  if (before === null) {
    writeResumableCache(rt, layout, { ref: after, terminal_ids: [...new Set(newlyTerminal)] })
    return
  }

  const cacheRead = readResumableCache(rt, layout)
  if (cacheRead.kind !== 'cache' || cacheRead.value.ref !== before) return

  const terminalIds = [...new Set([...cacheRead.value.terminal_ids, ...newlyTerminal])]
  writeResumableCache(rt, layout, { ref: after, terminal_ids: terminalIds })
}
