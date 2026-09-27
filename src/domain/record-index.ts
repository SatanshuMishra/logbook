import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Artifact, Criterion, OutOfScope, Risk, Thread } from '../schema/thread.ts'
import type { Slot, Store } from '../store/records.ts'
import { unescapeStored } from '../render/escape.ts'

export type RecordKind = 'decision' | 'risk' | 'criterion' | 'entry' | 'artifact' | 'out-of-scope'

type IndexedBase = {
  id: string
  threadId: string
  threadSlug: string
  threadStatus: string
  live: boolean
  supersededBy: string[]
  fields: string[]
}

export type IndexedRecord =
  | (IndexedBase & { kind: 'decision'; decision: Decision })
  | (IndexedBase & { kind: 'risk'; risk: Risk })
  | (IndexedBase & { kind: 'criterion'; criterion: Criterion })
  | (IndexedBase & { kind: 'entry'; entry: SessionEntry })
  | (IndexedBase & { kind: 'artifact'; artifact: Artifact })
  | (IndexedBase & { kind: 'out-of-scope'; note: OutOfScope })

type ThreadPlace = Pick<IndexedBase, 'threadId' | 'threadSlug' | 'threadStatus'>

const placeOf = (thread: Thread): ThreadPlace => ({
  threadId: thread.id,
  threadSlug: thread.slug,
  threadStatus: thread.status
})

const readable = <T>(slots: readonly Slot<T>[]): T[] => slots.flatMap((slot) => (slot.quarantined ? [] : [slot.record]))

const byId = (left: { id: string }, right: { id: string }): number => {
  if (left.id < right.id) return -1
  return left.id > right.id ? 1 : 0
}

const unescapedFields = (values: readonly (string | null | undefined)[]): string[] =>
  values.flatMap((value) => (typeof value === 'string' ? [unescapeStored(value)] : []))

const riskRecord = (place: ThreadPlace, risk: Risk): IndexedRecord => ({
  kind: 'risk',
  id: risk.id,
  ...place,
  live: !risk.retired,
  supersededBy: [],
  fields: unescapedFields([risk.text, risk.scope, ...risk.refs]),
  risk
})

const criterionRecord = (place: ThreadPlace, criterion: Criterion): IndexedRecord => ({
  kind: 'criterion',
  id: criterion.id,
  ...place,
  live: criterion.struck_by === null,
  supersededBy: [],
  fields: unescapedFields([criterion.text, criterion.check, criterion.result, criterion.settled_by]),
  criterion
})

const artifactRecord = (place: ThreadPlace, artifact: Artifact): IndexedRecord => ({
  kind: 'artifact',
  id: artifact.id,
  ...place,
  live: !artifact.retired,
  supersededBy: [],
  fields: unescapedFields([artifact.label, artifact.pointer]),
  artifact
})

const noteRecord = (place: ThreadPlace, note: OutOfScope): IndexedRecord => ({
  kind: 'out-of-scope',
  id: note.id,
  ...place,
  live: true,
  supersededBy: [],
  fields: unescapedFields([note.text]),
  note
})

const entryRecords = (store: Store, place: ThreadPlace): IndexedRecord[] =>
  readable(store.readSessionEntries(place.threadId)).flatMap((entry) => {
    const body = unescapeStored(entry.body)
    if (body.length === 0) return []
    const record: IndexedRecord = {
      kind: 'entry',
      id: entry.id,
      ...place,
      live: true,
      supersededBy: [],
      fields: [body],
      entry
    }
    return [record]
  })

const threadRecords = (store: Store, thread: Thread): IndexedRecord[] => {
  const place = placeOf(thread)
  return [
    ...thread.spine.open_risks.map((risk) => riskRecord(place, risk)),
    ...thread.completion_criteria.map((criterion) => criterionRecord(place, criterion)),
    ...(thread.artifacts ?? []).map((artifact) => artifactRecord(place, artifact)),
    ...thread.spine.out_of_scope.map((note) => noteRecord(place, note)),
    ...entryRecords(store, place)
  ]
}

const decisionRecords = (decisions: readonly Decision[], threadsById: ReadonlyMap<string, Thread>): IndexedRecord[] =>
  decisions.flatMap((decision) => {
    const thread = threadsById.get(decision.thread_id)
    if (thread === undefined) return []
    const supersededBy = decisions.filter((other) => other.supersedes.includes(decision.id)).map((other) => other.id)
    const record: IndexedRecord = {
      kind: 'decision',
      id: decision.id,
      ...placeOf(thread),
      live: supersededBy.length === 0,
      supersededBy,
      fields: unescapedFields([decision.title, decision.context, ...decision.options, decision.outcome]),
      decision
    }
    return [record]
  })

export const indexRecords = (store: Store): IndexedRecord[] => {
  const threads = readable(store.readThreads())
  const threadsById = new Map(threads.map((thread) => [thread.id, thread] as const))
  const decisions = readable(store.readDecisions()).sort(byId)
  return [...decisionRecords(decisions, threadsById), ...threads.flatMap((thread) => threadRecords(store, thread))]
}

export const resolveRecordIds = (
  index: readonly IndexedRecord[],
  ids: readonly string[]
): { found: IndexedRecord[]; missing: string[] } => {
  const byRecordId = new Map(index.map((record) => [record.id, record] as const))
  const distinct = [...new Set(ids)]
  return {
    found: distinct.flatMap((id) => {
      const record = byRecordId.get(id)
      return record === undefined ? [] : [record]
    }),
    missing: distinct.filter((id) => !byRecordId.has(id))
  }
}

const PATH_TOKEN = /[\p{L}\p{N}._\-/@+]+/gu
const TRAILING_DOTS = /\.+$/
const LEADING_CURRENT_DIRECTORY = /^(?:\.\/)+/
const FILE_EXTENSION = /\.[\p{L}\p{N}]*\p{L}[\p{L}\p{N}]*$/u

const asRelativePath = (token: string): string | null => {
  const candidate = token.replace(TRAILING_DOTS, '').replace(LEADING_CURRENT_DIRECTORY, '')
  if (candidate.startsWith('/') || candidate.includes('..') || !candidate.includes('/')) return null
  const lastSegment = candidate.slice(candidate.lastIndexOf('/') + 1)
  return FILE_EXTENSION.test(lastSegment) ? candidate : null
}

export const pathsNamedIn = (text: string): string[] => {
  const tokens = unescapeStored(text).match(PATH_TOKEN) ?? []
  const paths = tokens.flatMap((token) => {
    const relative = asRelativePath(token)
    return relative === null ? [] : [relative]
  })
  return [...new Set(paths)]
}

const governsByFileName = (record: IndexedRecord): boolean =>
  record.live && (record.kind === 'decision' || record.kind === 'risk')

const namesPath = (record: IndexedRecord, path: string): boolean => record.fields.some((field) => field.includes(path))

export const matchByFileName = (
  index: readonly IndexedRecord[],
  stepText: string,
  exclude: ReadonlySet<string>
): { path: string; record: IndexedRecord }[] => {
  const paths = pathsNamedIn(stepText)
  const matches = index
    .filter((record) => governsByFileName(record) && !exclude.has(record.id))
    .flatMap((record) => {
      const path = paths.find((candidate) => namesPath(record, candidate))
      return path === undefined ? [] : [{ path, record }]
    })
  return paths.flatMap((path) => matches.filter((match) => match.path === path))
}

const SEARCH_WHITESPACE_RUN = /[ \t\r\n\u2028\u2029]+/g

export const normaliseForSearch = (text: string): string =>
  text.toLowerCase().replace(SEARCH_WHITESPACE_RUN, ' ').trim()

export type SearchFilters = { text?: string; kind?: RecordKind; thread?: string; status?: 'live' | 'all' }

export const searchRecords = (
  index: readonly IndexedRecord[],
  filters: SearchFilters
): { records: IndexedRecord[]; searched: number; threads: number; missProvesNothing: boolean } => {
  const status = filters.status ?? 'live'
  const needle = filters.text === undefined ? null : normaliseForSearch(filters.text)
  const records = index.filter(
    (record) =>
      (filters.kind === undefined || record.kind === filters.kind) &&
      (filters.thread === undefined || record.threadId === filters.thread || record.threadSlug === filters.thread) &&
      (status === 'all' || record.live) &&
      (needle === null || record.fields.some((field) => normaliseForSearch(field).includes(needle)))
  )
  return {
    records,
    searched: index.length,
    threads: new Set(index.map((record) => record.threadId)).size,
    missProvesNothing: filters.text !== undefined
  }
}
