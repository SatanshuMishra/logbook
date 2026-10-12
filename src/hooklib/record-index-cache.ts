import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Decision } from '../schema/decision.ts'
import type { Risk, Thread } from '../schema/thread.ts'
import { createStateDirectory, type StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { openStore, type Store } from '../store/records.ts'
import {
  byId,
  decisionRecord,
  entryRecord,
  placeOf,
  readable,
  riskRecord,
  supersedersOf,
  threadFileRecords,
  type IndexedRecord,
  type RecordKind,
  type ThreadPlace
} from '../domain/record-index.ts'
import { ledgerPathsChangedSince, readLedgerHead } from './ledger-presence.ts'

const CACHE_FILE_NAME = 'hook-record-index.json'
const CACHE_FORMAT = 'logbook-hook-record-index-1'
const RECORD_KINDS: ReadonlySet<string> = new Set<RecordKind>([
  'decision',
  'risk',
  'criterion',
  'entry',
  'artifact',
  'out-of-scope'
])
const THREAD_FILE_KINDS: ReadonlySet<string> = new Set<RecordKind>(['risk', 'criterion', 'artifact', 'out-of-scope'])

type CachedThread = { slug: string; status: string; risks: Risk[] }
type CachedDecision = { thread_id: string; supersedes: string[]; record: Decision | null }
type CachedLocation = { kind: RecordKind; thread_id: string }

type CacheBody = {
  format: string
  commit: string | null
  threads: Record<string, CachedThread>
  decisions: Record<string, CachedDecision>
  locations: Record<string, CachedLocation>
}

export type RecordLocation = { kind: RecordKind; threadId: string }

export type HookRecordIndex = {
  liveDecisions: readonly IndexedRecord[]
  liveRisks: readonly IndexedRecord[]
  governing: readonly IndexedRecord[]
  locate: (id: string) => RecordLocation | null
  place: (threadId: string) => ThreadPlace | null
  supersededBy: (decisionId: string) => readonly string[]
  entryCount: (threadId: string) => number
}

type LedgerChange =
  | { kind: 'decision'; id: string }
  | { kind: 'thread'; id: string }
  | { kind: 'entry'; threadId: string; id: string }

const RECORD_FILE = /^([^/]+)\.json$/

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const everyValue = (value: unknown, check: (entry: unknown) => boolean): boolean =>
  isPlainObject(value) && Object.values(value).every(check)

const isCachedThread = (value: unknown): boolean =>
  isPlainObject(value) && typeof value.slug === 'string' && typeof value.status === 'string' && Array.isArray(value.risks)

const isCachedDecision = (value: unknown): boolean =>
  isPlainObject(value) &&
  typeof value.thread_id === 'string' &&
  isStringArray(value.supersedes) &&
  (value.record === null || isPlainObject(value.record))

const isCachedLocation = (value: unknown): boolean =>
  isPlainObject(value) && typeof value.kind === 'string' && RECORD_KINDS.has(value.kind) && typeof value.thread_id === 'string'

const isCacheBody = (value: unknown): value is CacheBody =>
  isPlainObject(value) &&
  value.format === CACHE_FORMAT &&
  (value.commit === null || typeof value.commit === 'string') &&
  everyValue(value.threads, isCachedThread) &&
  everyValue(value.decisions, isCachedDecision) &&
  everyValue(value.locations, isCachedLocation)

const cachePathFor = (layout: StoreLayout): string => path.join(layout.state, CACHE_FILE_NAME)

const readCache = (layout: StoreLayout): CacheBody | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePathFor(layout), 'utf8'))
    return isCacheBody(parsed) ? parsed : null
  } catch {
    return null
  }
}

const writeCache = (rt: Runtime, layout: StoreLayout, body: CacheBody): void => {
  try {
    createStateDirectory(layout)
    durableWrite(cachePathFor(layout), JSON.stringify(body), { log: rt.log })
  } catch (error) {
    rt.log({
      level: 'warn',
      event: 'record-index-cache.write-failed',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

const cachedThread = (thread: Thread): CachedThread => ({
  slug: thread.slug,
  status: thread.status,
  risks: thread.spine.open_risks.filter((risk) => !risk.retired)
})

const cachedDecision = (decision: Decision): CachedDecision => ({
  thread_id: decision.thread_id,
  supersedes: decision.supersedes,
  record: decision
})

const locationOf = (record: IndexedRecord): [string, CachedLocation] => [
  record.id,
  { kind: record.kind, thread_id: record.threadId }
]

const entryLocations = (store: Store, thread: Thread): [string, CachedLocation][] => {
  const place = placeOf(thread)
  return readable(store.readSessionEntries(thread.id)).flatMap((entry) => {
    const record = entryRecord(place, entry)
    return record === null ? [] : [locationOf(record)]
  })
}

const decisionLocation = (decision: Decision): [string, CachedLocation] => [
  decision.id,
  { kind: 'decision', thread_id: decision.thread_id }
]

const rebuild = (store: Store, commit: string | null): CacheBody => {
  const threads = readable(store.readThreads())
  const decisions = readable(store.readDecisions()).sort(byId)
  return {
    format: CACHE_FORMAT,
    commit,
    threads: Object.fromEntries(threads.map((thread) => [thread.id, cachedThread(thread)])),
    decisions: Object.fromEntries(decisions.map((decision) => [decision.id, cachedDecision(decision)])),
    locations: Object.fromEntries([
      ...decisions.map(decisionLocation),
      ...threads.flatMap((thread) => [...threadFileRecords(thread).map(locationOf), ...entryLocations(store, thread)])
    ])
  }
}

const recordIdOf = (fileName: string | undefined): string | undefined => RECORD_FILE.exec(fileName ?? '')?.[1]

const parseLedgerPath = (ledgerPath: string): LedgerChange | null => {
  const segments = ledgerPath.split('/')
  const [area, first, second] = segments
  if (area === 'decisions' && segments.length === 2) {
    const id = recordIdOf(first)
    return id === undefined ? null : { kind: 'decision', id }
  }
  if (area === 'threads' && segments.length === 2) {
    const id = recordIdOf(first)
    return id === undefined ? null : { kind: 'thread', id }
  }
  if (area === 'sessions' && segments.length === 3 && first !== undefined) {
    const id = recordIdOf(second)
    return id === undefined ? null : { kind: 'entry', threadId: first, id }
  }
  return null
}

const loadedRecord = <T>(slot: { quarantined: false; record: T } | { quarantined: true } | null): T | null =>
  slot === null || slot.quarantined ? null : slot.record

const applyChanges = (store: Store, body: CacheBody, changes: readonly LedgerChange[], commit: string | null): CacheBody => {
  const decisionIds = new Set(changes.flatMap((change) => (change.kind === 'decision' ? [change.id] : [])))
  const threadIds = new Set(changes.flatMap((change) => (change.kind === 'thread' ? [change.id] : [])))
  const changedDecisions = [...decisionIds].map((id) => ({ id, decision: loadedRecord(store.readDecision(id)) }))
  const changedThreads = [...threadIds].map((id) => ({ id, thread: loadedRecord(store.readThread(id)) }))
  const presentThreads = changedThreads.flatMap(({ thread }) => (thread === null ? [] : [thread]))
  const arrivingThreads = presentThreads.filter((thread) => body.threads[thread.id] === undefined)
  const arrivingThreadIds = new Set(arrivingThreads.map((thread) => thread.id))
  const goneThreadIds = new Set(changedThreads.flatMap(({ id, thread }) => (thread === null ? [id] : [])))
  const changedEntries = changes.flatMap((change) =>
    change.kind === 'entry' && !arrivingThreadIds.has(change.threadId) && !goneThreadIds.has(change.threadId)
      ? [{ id: change.id, threadId: change.threadId, entry: loadedRecord(store.readSessionEntry(change.threadId, change.id)) }]
      : []
  )
  const changedEntryIds = new Set(changedEntries.map((change) => change.id))

  const keepsLocation = (id: string, location: CachedLocation): boolean =>
    !decisionIds.has(id) &&
    !changedEntryIds.has(id) &&
    !(goneThreadIds.has(location.thread_id) && location.kind !== 'decision') &&
    !(arrivingThreadIds.has(location.thread_id) && location.kind === 'entry') &&
    !(threadIds.has(location.thread_id) && THREAD_FILE_KINDS.has(location.kind))

  const threadsAfter: Record<string, CachedThread> = Object.fromEntries([
    ...Object.entries(body.threads).filter(([id]) => !threadIds.has(id)),
    ...presentThreads.map((thread) => [thread.id, cachedThread(thread)] as const)
  ])

  const entryPlace = (threadId: string): ThreadPlace => {
    const known = threadsAfter[threadId]
    return { threadId, threadSlug: known?.slug ?? '', threadStatus: known?.status ?? '' }
  }

  return {
    format: CACHE_FORMAT,
    commit,
    threads: threadsAfter,
    decisions: Object.fromEntries([
      ...Object.entries(body.decisions).filter(([id]) => !decisionIds.has(id)),
      ...changedDecisions.flatMap(({ id, decision }) => (decision === null ? [] : [[id, cachedDecision(decision)] as const]))
    ]),
    locations: Object.fromEntries([
      ...Object.entries(body.locations).filter(([id, location]) => keepsLocation(id, location)),
      ...changedDecisions.flatMap(({ decision }) => (decision === null ? [] : [decisionLocation(decision)])),
      ...presentThreads.flatMap((thread) => threadFileRecords(thread).map(locationOf)),
      ...arrivingThreads.flatMap((thread) => entryLocations(store, thread)),
      ...changedEntries.flatMap(({ threadId, entry }) => {
        const record = entry === null ? null : entryRecord(entryPlace(threadId), entry)
        return record === null ? [] : [locationOf(record)]
      })
    ])
  }
}

const settleLiveness = (store: Store, body: CacheBody): CacheBody => {
  const superseders = supersedersOf(
    Object.entries(body.decisions).map(([id, decision]) => ({ id, supersedes: decision.supersedes }))
  )
  const settled = Object.entries(body.decisions).flatMap(([id, decision]): [string, CachedDecision][] => {
    const live = (superseders.get(id) ?? []).length === 0
    if (!live) return [[id, { ...decision, record: null }]]
    if (decision.record !== null) return [[id, decision]]
    const reread = loadedRecord(store.readDecision(id))
    return reread === null ? [] : [[id, cachedDecision(reread)]]
  })
  const kept = new Set(settled.map(([id]) => id))
  return {
    ...body,
    decisions: Object.fromEntries(settled),
    locations: Object.fromEntries(
      Object.entries(body.locations).filter(([id, location]) => location.kind !== 'decision' || kept.has(id))
    )
  }
}

const deriveIndex = (body: CacheBody): HookRecordIndex => {
  const places = new Map(
    Object.entries(body.threads).map(([id, thread]) => [id, { threadId: id, threadSlug: thread.slug, threadStatus: thread.status }] as const)
  )
  const superseders = supersedersOf(
    Object.entries(body.decisions).map(([id, decision]) => ({ id, supersedes: decision.supersedes }))
  )
  const liveDecisions = Object.keys(body.decisions)
    .sort()
    .flatMap((id) => {
      const cached = body.decisions[id]
      const place = cached === undefined ? undefined : places.get(cached.thread_id)
      if (cached === undefined || cached.record === null || place === undefined) return []
      const supersededBy = superseders.get(id) ?? []
      return supersededBy.length === 0 ? [decisionRecord(place, cached.record, supersededBy)] : []
    })
  const liveRisks = [...places.keys()].sort().flatMap((threadId) => {
    const place = places.get(threadId)
    const thread = body.threads[threadId]
    if (place === undefined || thread === undefined) return []
    return thread.risks.map((risk) => riskRecord(place, risk)).filter((record) => record.live)
  })
  return {
    liveDecisions,
    liveRisks,
    governing: [...liveDecisions, ...liveRisks],
    locate: (id) => {
      const location = body.locations[id]
      if (location === undefined || !places.has(location.thread_id)) return null
      if (location.kind === 'decision' && body.decisions[id] === undefined) return null
      return { kind: location.kind, threadId: location.thread_id }
    },
    place: (threadId) => places.get(threadId) ?? null,
    supersededBy: (decisionId) => superseders.get(decisionId) ?? [],
    entryCount: (threadId) =>
      Object.values(body.locations).filter((location) => location.kind === 'entry' && location.thread_id === threadId).length
  }
}

const openForUpdate = (rt: Runtime, layout: StoreLayout): Store => {
  const opened = openStore(rt, layout.projectRoot)
  if (!opened.ok) throw new Error(`the store did not open: ${opened.message}`)
  return opened.value
}

const updatedBody = (rt: Runtime, layout: StoreLayout, cached: CacheBody | null, head: string | null): CacheBody => {
  const store = openForUpdate(rt, layout)
  if (cached === null || cached.commit === null || head === null) return settleLiveness(store, rebuild(store, head))
  const diff = ledgerPathsChangedSince(rt, layout.projectRoot, cached.commit)
  if (!diff.ok) return settleLiveness(store, rebuild(store, head))
  const changes = diff.paths.flatMap((ledgerPath) => {
    const change = parseLedgerPath(ledgerPath)
    return change === null ? [] : [change]
  })
  return settleLiveness(store, applyChanges(store, cached, changes, head))
}

export const loadHookRecordIndex = (rt: Runtime, layout: StoreLayout): HookRecordIndex => {
  const head = readLedgerHead(rt, layout.projectRoot)
  const cached = readCache(layout)
  if (cached !== null && cached.commit === head) return deriveIndex(cached)
  const body = updatedBody(rt, layout, cached, head)
  if (readLedgerHead(rt, layout.projectRoot) === head) writeCache(rt, layout, body)
  return deriveIndex(body)
}

export const readIndexedRecord = (
  store: Store,
  index: HookRecordIndex,
  id: string,
  threadsRead: ReadonlyMap<string, Thread> = new Map()
): IndexedRecord | null => {
  const location = index.locate(id)
  const place = location === null ? null : index.place(location.threadId)
  if (location === null || place === null) return null
  if (location.kind === 'decision') {
    const decision = loadedRecord(store.readDecision(id))
    return decision === null ? null : decisionRecord(place, decision, index.supersededBy(id))
  }
  if (location.kind === 'entry') {
    const entry = loadedRecord(store.readSessionEntry(location.threadId, id))
    return entry === null ? null : entryRecord(place, entry)
  }
  const thread = threadsRead.get(location.threadId) ?? loadedRecord(store.readThread(location.threadId))
  if (thread === null) return null
  return threadFileRecords(thread).find((record) => record.id === id && record.kind === location.kind) ?? null
}
