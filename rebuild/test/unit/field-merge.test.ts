import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord } from '../../src/schema/thread.ts'
import type { Thread, Spine, Criterion } from '../../src/schema/thread.ts'
import type { Decision } from '../../src/schema/decision.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import { resolveNode } from '../../src/schema/example.ts'
import { census } from '../support/census.ts'
import { THREAD_RULES, mergeThread, mergeDecision, mergeSession } from '../../src/merge/field-merge.ts'
import type { FieldRule } from '../../src/merge/field-merge.ts'

type JsonSchemaNode = Record<string, unknown>
const isNode = (value: unknown): value is JsonSchemaNode => typeof value === 'object' && value !== null

const walkThreadRulePaths = (root: JsonSchemaNode): string[] => {
  const top = resolveNode(root, root)
  const topProperties = isNode(top.properties) ? (top.properties as Record<string, unknown>) : {}
  const paths: string[] = []
  for (const [key, rawValue] of Object.entries(topProperties)) {
    paths.push(key)
    if (!isNode(rawValue)) {
      continue
    }
    const resolved = resolveNode(root, rawValue)
    if (resolved.type === 'object' && isNode(resolved.properties)) {
      for (const subKey of Object.keys(resolved.properties as Record<string, unknown>)) {
        paths.push(`${key}.${subKey}`)
      }
    }
  }
  return paths
}

const exercisedRules = new Set<FieldRule>()
const recordCoverage = (rule: FieldRule): void => {
  exercisedRules.add(rule)
}

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAA'
const ULID_B = '01ARZ3NDEKTSV4RRFFQ69G5FBB'
const ULID_C = '01ARZ3NDEKTSV4RRFFQ69G5FCC'
const ULID_D = '01ARZ3NDEKTSV4RRFFQ69G5FDD'
const ULID_THREAD = '01ARZ3NDEKTSV4RRFFQ69G5F00'
const ULID_DECISION_1 = '01ARZ3NDEKTSV4RRFFQ69G5FD1'
const ULID_DECISION_2 = '01ARZ3NDEKTSV4RRFFQ69G5FD2'

const baseSpine = (): Spine => ({
  active_goal: 'ship the merge engine',
  next_step: 'write the field rules',
  last_session: 'read the spec',
  open_risks: [],
  key_decisions: [],
  out_of_scope: []
})

const baseThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: ULID_THREAD,
  slug: 'merge-engine',
  title: 'Field-level merge',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: baseSpine(),
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  ...overrides
})

const criterion = (id: string, text: string, ordinal: number): Criterion => ({
  id,
  ordinal,
  text,
  done: false,
  kind: 'planned',
  struck_by: null
})

const decision = (id: string, overrides: Partial<Decision> = {}): Decision => ({
  id,
  thread_id: ULID_THREAD,
  title: 'a decision',
  context: 'context',
  options: ['a', 'b'],
  outcome: 'chose a',
  commit: null,
  supersedes: [],
  created_at: '2026-08-01T00:00:00.000Z',
  ...overrides
})

const sessionEntry = (id: string, overrides: Partial<SessionEntry> = {}): SessionEntry => ({
  id,
  thread_id: ULID_THREAD,
  actor: 'ana',
  body: 'did some work',
  created_at: '2026-08-01T00:00:00.000Z',
  ...overrides
})

test('merge.takes-the-only-side', () => {
  const base = baseThread({ blocked_by: null })
  const ours = baseThread({ blocked_by: null })
  const theirs = baseThread({ blocked_by: 'waiting on a review' })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the merge to succeed')
  }
  assert.equal(result.merged.blocked_by, 'waiting on a review')
  assert.equal(ThreadRecord.parse(result.merged).ok, true)
  recordCoverage('take-present')
})

test('merge.takes-identical', () => {
  const base = baseThread({ title: 'Field-level merge' })
  const ours = baseThread({ title: 'Field-level merge' })
  const theirs = baseThread({ title: 'Field-level merge' })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the merge to succeed')
  }
  assert.equal(result.merged.title, 'Field-level merge')
  recordCoverage('take-present')
})

test('merge.unions-criteria', () => {
  const base = baseThread({ completion_criteria: [] })
  const ours = baseThread({ completion_criteria: [criterion(ULID_B, 'add the b criterion', 1)] })
  const theirs = baseThread({ completion_criteria: [criterion(ULID_A, 'add the a criterion', 1)] })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the merge to succeed')
  }
  assert.deepEqual(
    result.merged.completion_criteria.map((c) => c.id),
    [ULID_A, ULID_B]
  )
  assert.deepEqual(
    result.merged.completion_criteria.map((c) => c.ordinal),
    [1, 2]
  )
  recordCoverage('union-by-id')
})

test('merge.conflicts-on-same-id', () => {
  const base = baseThread({ completion_criteria: [] })
  const ours = baseThread({ completion_criteria: [criterion(ULID_C, 'ours version of the text', 1)] })
  const theirs = baseThread({ completion_criteria: [criterion(ULID_C, 'theirs version of the text', 1)] })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the merge to refuse')
  }
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.record, `thread:${ULID_THREAD}`)
  assert.equal(found.field, 'completion_criteria')
  assert.equal((found.ours as Criterion).text, 'ours version of the text')
  assert.equal((found.theirs as Criterion).text, 'theirs version of the text')
  recordCoverage('union-by-id')
})

test('merge.conflicts-on-scalar', () => {
  const base = baseThread({ spine: { ...baseSpine(), next_step: 'the original step' } })
  const ours = baseThread({ spine: { ...baseSpine(), next_step: 'A' } })
  const theirs = baseThread({ spine: { ...baseSpine(), next_step: 'B' } })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the merge to refuse')
  }
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, 'spine.next_step')
  assert.equal(found.ours, 'A')
  assert.equal(found.theirs, 'B')
  recordCoverage('conflict-on-divergence')
})

test('merge.decision-never-conflicts', () => {
  const first = mergeDecision(decision(ULID_DECISION_1), decision(ULID_DECISION_1))
  const second = mergeDecision(decision(ULID_DECISION_2), decision(ULID_DECISION_2))

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) {
    throw new Error('expected both decisions to merge without conflict')
  }
  assert.equal(first.merged.id, ULID_DECISION_1)
  assert.equal(second.merged.id, ULID_DECISION_2)
  assert.notEqual(first.merged.id, second.merged.id)
})

test('merge.session-unions', () => {
  const ours = [sessionEntry(ULID_A), sessionEntry(ULID_B)]
  const theirs = [sessionEntry(ULID_B), sessionEntry(ULID_C)]

  const result = mergeSession(ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the merge to succeed')
  }
  assert.deepEqual(
    result.merged.map((entry) => entry.id),
    [ULID_A, ULID_B, ULID_C]
  )
  recordCoverage('union-by-id')
})

test('merge.rule-table-is-covered', () => {
  const paths = walkThreadRulePaths(ThreadRecord.jsonSchema)
  assert.ok(paths.length > 0)

  census(paths, (path) => {
    const rule = (THREAD_RULES as Record<string, FieldRule>)[path]
    return rule === undefined ? 'unclassifiable' : 'allowed'
  })

  const usedRules = new Set(Object.values(THREAD_RULES))
  for (const rule of usedRules) {
    assert.ok(exercisedRules.has(rule), `no behavioural test named a rule-table entry exercising ${rule}`)
  }
})

test('merge.rule-table-is-covered.walk-finds-spine-and-top-level-paths', () => {
  const paths = walkThreadRulePaths(ThreadRecord.jsonSchema)
  assert.deepEqual(
    [...paths].sort(),
    [
      'blocked_by',
      'completion_criteria',
      'created_at',
      'id',
      'slug',
      'spine',
      'spine.active_goal',
      'spine.key_decisions',
      'spine.last_session',
      'spine.next_step',
      'spine.out_of_scope',
      'spine.open_risks',
      'status',
      'title',
      'updated_at'
    ].sort()
  )
})
