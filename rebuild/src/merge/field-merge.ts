import { isDeepStrictEqual } from 'node:util'
import type { Thread, Spine, Criterion } from '../schema/thread.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import { conflict } from './conflict.ts'
import type { Conflict } from './conflict.ts'

export type { Conflict } from './conflict.ts'

export type MergeResult<T> = { ok: true; merged: T } | { ok: false; conflicts: Conflict[] }

export type FieldRule = 'take-present' | 'union-by-id' | 'conflict-on-divergence'

export const THREAD_RULES: Record<keyof Thread | `spine.${keyof Spine}`, FieldRule> = {
  id: 'take-present',
  slug: 'conflict-on-divergence',
  title: 'conflict-on-divergence',
  status: 'conflict-on-divergence',
  blocked_by: 'conflict-on-divergence',
  completion_criteria: 'union-by-id',
  spine: 'take-present',
  created_at: 'take-present',
  updated_at: 'take-present',
  'spine.active_goal': 'conflict-on-divergence',
  'spine.next_step': 'conflict-on-divergence',
  'spine.last_session': 'conflict-on-divergence',
  'spine.open_risks': 'union-by-id',
  'spine.key_decisions': 'union-by-id',
  'spine.out_of_scope': 'union-by-id'
}

type ScalarDescriptor = { path: string; rule: FieldRule; get: (thread: Thread) => unknown }

const SCALAR_DESCRIPTORS: ScalarDescriptor[] = [
  { path: 'id', rule: THREAD_RULES.id, get: (t) => t.id },
  { path: 'slug', rule: THREAD_RULES.slug, get: (t) => t.slug },
  { path: 'title', rule: THREAD_RULES.title, get: (t) => t.title },
  { path: 'status', rule: THREAD_RULES.status, get: (t) => t.status },
  { path: 'blocked_by', rule: THREAD_RULES.blocked_by, get: (t) => t.blocked_by },
  { path: 'created_at', rule: THREAD_RULES.created_at, get: (t) => t.created_at },
  { path: 'spine.active_goal', rule: THREAD_RULES['spine.active_goal'], get: (t) => t.spine.active_goal },
  { path: 'spine.next_step', rule: THREAD_RULES['spine.next_step'], get: (t) => t.spine.next_step },
  { path: 'spine.last_session', rule: THREAD_RULES['spine.last_session'], get: (t) => t.spine.last_session }
]

const isAbsent = (value: unknown): boolean => value === null || value === undefined

type ScalarResolution = { path: string; value: unknown; conflict: Conflict | null }

const resolveScalarField = (
  recordName: string,
  base: Thread | null,
  ours: Thread,
  theirs: Thread,
  descriptor: ScalarDescriptor
): ScalarResolution => {
  const oursValue = descriptor.get(ours)
  const theirsValue = descriptor.get(theirs)
  if (isDeepStrictEqual(oursValue, theirsValue)) {
    return { path: descriptor.path, value: oursValue, conflict: null }
  }
  const baseValue = base === null ? undefined : descriptor.get(base)
  const oursChanged = base === null ? true : !isDeepStrictEqual(oursValue, baseValue)
  const theirsChanged = base === null ? true : !isDeepStrictEqual(theirsValue, baseValue)
  if (!oursChanged && theirsChanged) {
    return { path: descriptor.path, value: theirsValue, conflict: null }
  }
  if (oursChanged && !theirsChanged) {
    return { path: descriptor.path, value: oursValue, conflict: null }
  }
  if (isAbsent(oursValue) && !isAbsent(theirsValue)) {
    return { path: descriptor.path, value: theirsValue, conflict: null }
  }
  if (isAbsent(theirsValue) && !isAbsent(oursValue)) {
    return { path: descriptor.path, value: oursValue, conflict: null }
  }
  if (descriptor.rule === 'conflict-on-divergence') {
    return {
      path: descriptor.path,
      value: oursValue,
      conflict: conflict(recordName, descriptor.path, oursValue, theirsValue)
    }
  }
  return { path: descriptor.path, value: oursValue, conflict: null }
}

const byIdAscending = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

type IdOwner = { id: string }

const unionByIdGeneric = <T extends IdOwner>(ours: T[], theirs: T[]): T[] => {
  const merged = new Map<string, T>()
  for (const item of ours) {
    merged.set(item.id, item)
  }
  for (const item of theirs) {
    if (!merged.has(item.id)) {
      merged.set(item.id, item)
    }
  }
  return [...merged.values()].sort(byIdAscending)
}

const unionCriteria = (
  recordName: string,
  ours: Criterion[],
  theirs: Criterion[]
): { merged: Criterion[]; conflicts: Conflict[] } => {
  const oursById = new Map(ours.map((item) => [item.id, item] as const))
  const theirsById = new Map(theirs.map((item) => [item.id, item] as const))
  const ids = new Set([...oursById.keys(), ...theirsById.keys()])
  const conflicts: Conflict[] = []
  const chosen: Criterion[] = []
  for (const id of ids) {
    const oursItem = oursById.get(id)
    const theirsItem = theirsById.get(id)
    if (oursItem !== undefined && theirsItem !== undefined) {
      if (oursItem.text !== theirsItem.text) {
        conflicts.push(conflict(recordName, 'completion_criteria', oursItem, theirsItem))
      }
      chosen.push(oursItem)
    } else {
      chosen.push((oursItem ?? theirsItem) as Criterion)
    }
  }
  const ordered = [...chosen].sort(byIdAscending)
  const merged = ordered.map((criterion, index) => ({ ...criterion, ordinal: index + 1 }))
  return { merged, conflicts }
}

export const mergeThread = (base: Thread | null, ours: Thread, theirs: Thread): MergeResult<Thread> => {
  const recordName = `thread:${ours.id}`

  const scalarResolutions = SCALAR_DESCRIPTORS.map((descriptor) =>
    resolveScalarField(recordName, base, ours, theirs, descriptor)
  )
  const criteriaResolution = unionCriteria(recordName, ours.completion_criteria, theirs.completion_criteria)

  const openRisks = unionByIdGeneric(ours.spine.open_risks, theirs.spine.open_risks)
  const keyDecisions = unionByIdGeneric(ours.spine.key_decisions, theirs.spine.key_decisions)
  const outOfScope = unionByIdGeneric(ours.spine.out_of_scope, theirs.spine.out_of_scope)

  const conflicts = [
    ...scalarResolutions.flatMap((resolution) => (resolution.conflict ? [resolution.conflict] : [])),
    ...criteriaResolution.conflicts
  ]

  if (conflicts.length > 0) {
    return { ok: false, conflicts }
  }

  const byPath = new Map(scalarResolutions.map((resolution) => [resolution.path, resolution.value] as const))
  const updatedAt = ours.updated_at > theirs.updated_at ? ours.updated_at : theirs.updated_at

  const merged: Thread = {
    id: byPath.get('id') as Thread['id'],
    slug: byPath.get('slug') as Thread['slug'],
    title: byPath.get('title') as Thread['title'],
    status: byPath.get('status') as Thread['status'],
    blocked_by: byPath.get('blocked_by') as Thread['blocked_by'],
    completion_criteria: criteriaResolution.merged,
    spine: {
      active_goal: byPath.get('spine.active_goal') as Spine['active_goal'],
      next_step: byPath.get('spine.next_step') as Spine['next_step'],
      last_session: byPath.get('spine.last_session') as Spine['last_session'],
      open_risks: openRisks,
      key_decisions: keyDecisions,
      out_of_scope: outOfScope
    },
    created_at: byPath.get('created_at') as Thread['created_at'],
    updated_at: updatedAt
  }

  return { ok: true, merged }
}

export const mergeDecision = (ours: Decision, _theirs: Decision): MergeResult<Decision> => ({
  ok: true,
  merged: ours
})

export const mergeSession = (ours: SessionEntry[], theirs: SessionEntry[]): MergeResult<SessionEntry[]> => ({
  ok: true,
  merged: unionByIdGeneric(ours, theirs)
})
