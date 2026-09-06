import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord } from '../../src/schema/thread.ts'
import type { Thread, Spine, Criterion, Risk } from '../../src/schema/thread.ts'
import type { Decision } from '../../src/schema/decision.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import { resolveNode } from '../../src/schema/example.ts'
import { census } from '../support/census.ts'
import {
  THREAD_RULES,
  mergeThread,
  mergeThreadTraced,
  mergeDecision,
  mergeSession,
  resolveScalarField,
  mergedThreadFieldPaths
} from '../../src/merge/field-merge.ts'
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
  landed: 'read the spec',
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
  assert.equal(found.field, `completion_criteria[${ULID_C}]`)
  assert.equal((found.ours as Criterion).text, 'ours version of the text')
  assert.equal((found.theirs as Criterion).text, 'theirs version of the text')
})

test('merge.criteria-conflict-on-done-divergence', () => {
  const base = baseThread({ completion_criteria: [criterion(ULID_C, 'shared text', 1)] })
  const ours = baseThread({
    completion_criteria: [{ ...criterion(ULID_C, 'shared text', 1), done: false }]
  })
  const theirs = baseThread({
    completion_criteria: [{ ...criterion(ULID_C, 'shared text', 1), done: true }]
  })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the merge to refuse over a done divergence')
  }
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, `completion_criteria[${ULID_C}]`)
  assert.equal((found.ours as Criterion).done, false)
  assert.equal((found.theirs as Criterion).done, true)
})

test('merge.spine-open-risks-conflict-on-divergence', () => {
  const base = baseThread({ spine: { ...baseSpine(), open_risks: [] } })
  const ours = baseThread({
    spine: { ...baseSpine(), open_risks: [{ id: ULID_D, scope: 'merge', text: 'ours risk text', refs: [], retired: false }] }
  })
  const theirs = baseThread({
    spine: { ...baseSpine(), open_risks: [{ id: ULID_D, scope: 'merge', text: 'theirs risk text', refs: [], retired: false }] }
  })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the merge to refuse over an open-risk divergence')
  }
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, `spine.open_risks[${ULID_D}]`)
})

test('merge.spine-open-risks-conflict-on-criterion-id-divergence', () => {
  const base = baseThread({ spine: { ...baseSpine(), open_risks: [] } })
  const ours = baseThread({
    spine: {
      ...baseSpine(),
      open_risks: [{ id: ULID_D, scope: 'merge', text: 'shared risk text', refs: [], criterion_id: ULID_A, retired: false }]
    }
  })
  const theirs = baseThread({
    spine: {
      ...baseSpine(),
      open_risks: [{ id: ULID_D, scope: 'merge', text: 'shared risk text', refs: [], criterion_id: ULID_B, retired: false }]
    }
  })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the merge to refuse over a criterion_id-only divergence')
  }
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, `spine.open_risks[${ULID_D}]`)
  assert.deepEqual(found.ours, { id: ULID_D, scope: 'merge', text: 'shared risk text', refs: [], criterion_id: ULID_A, retired: false })
  assert.deepEqual(found.theirs, { id: ULID_D, scope: 'merge', text: 'shared risk text', refs: [], criterion_id: ULID_B, retired: false })
})

test('merge.spine-open-risks-one-sided-add-with-criterion-id-survives-intact', () => {
  const risk: Risk = { id: ULID_D, scope: 'merge', text: 'anchored risk', refs: [], criterion_id: ULID_A, retired: false }
  const base = baseThread({ spine: { ...baseSpine(), open_risks: [] } })
  const ours = baseThread({ spine: { ...baseSpine(), open_risks: [risk] } })
  const theirs = baseThread({ spine: { ...baseSpine(), open_risks: [] } })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected a one-sided add to merge without conflict')
  }
  assert.deepEqual(result.merged.spine.open_risks, [risk])
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
})

test('merge.conflict-on-divergence-field-cleared-to-null-still-conflicts', () => {
  const base = baseThread({ blocked_by: 'waiting on review' })
  const ours = baseThread({ blocked_by: null })
  const theirs = baseThread({ blocked_by: 'waiting on legal' })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the merge to refuse rather than silently keep theirs')
  }
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, 'blocked_by')
  assert.equal(found.ours, null)
  assert.equal(found.theirs, 'waiting on legal')
})

test('merge.take-present-absence-arm-fires-when-base-is-absent', () => {
  const ours = { ...baseThread(), id: null } as unknown as Thread
  const theirs = baseThread({ id: ULID_B })

  const result = mergeThread(null, ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the merge to take the present side')
  }
  assert.equal(result.merged.id, ULID_B)
})

test('merge.scalar-resolution-throws-on-unhandled-rule', () => {
  const base = baseThread({ title: 'A' })
  const ours = baseThread({ title: 'B' })
  const theirs = baseThread({ title: 'C' })

  assert.throws(() =>
    resolveScalarField('thread:test', base, ours, theirs, {
      path: 'title',
      rule: 'union-by-id',
      get: (t) => t.title
    })
  )
})

test('merge.decision-identical-content-succeeds', () => {
  const first = mergeDecision(decision(ULID_DECISION_1), decision(ULID_DECISION_1))
  const second = mergeDecision(decision(ULID_DECISION_2), decision(ULID_DECISION_2))

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) {
    throw new Error('expected both decisions to merge without conflict')
  }
  assert.equal(first.merged.id, ULID_DECISION_1)
  assert.equal(second.merged.id, ULID_DECISION_2)
})

test('merge.decision-diverging-content-conflicts', () => {
  const ours = decision(ULID_DECISION_1, { outcome: 'chose a' })
  const theirs = decision(ULID_DECISION_1, { outcome: 'chose b' })

  const result = mergeDecision(ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the merge to refuse a diverging decision body')
  }
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.record, `decision:${ULID_DECISION_1}`)
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
})

test('merge.rule-table-is-covered', () => {
  const paths = walkThreadRulePaths(ThreadRecord.jsonSchema)
  assert.ok(paths.length > 0)

  census(paths, (path) => {
    const rule = (THREAD_RULES as Record<string, FieldRule>)[path]
    return rule === undefined ? 'unclassifiable' : 'allowed'
  })

  const base = baseThread({ id: ULID_THREAD, created_at: '2026-08-01T00:00:00.000Z' })
  const ours = baseThread({ id: ULID_A, created_at: '2026-08-02T00:00:00.000Z', slug: 'ours-slug' })
  const theirs = baseThread({ id: ULID_B, created_at: '2026-08-03T00:00:00.000Z', slug: 'theirs-slug' })

  const { dispatchedRules } = mergeThreadTraced(base, ours, theirs)
  const exercisedRules = new Set(dispatchedRules)

  const usedRules = new Set(Object.values(THREAD_RULES))
  for (const rule of usedRules) {
    assert.ok(exercisedRules.has(rule), `no rule dispatch in field-merge.ts exercised ${rule}`)
  }
})

test('merge.artifacts-survive-the-merge', () => {
  const artifact = { id: ULID_C, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  const base = baseThread({ artifacts: [] })
  const ours = baseThread({ artifacts: [artifact] })
  const theirs = baseThread({ artifacts: [] })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the merge to succeed')
  assert.deepEqual(result.merged.artifacts, [artifact])
})

test('merge.a-one-sided-artifact-removal-conflicts-rather-than-losing', () => {
  const live = { id: ULID_C, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  const gone = { ...live, retired: true }
  const base = baseThread({ artifacts: [live] })
  const ours = baseThread({ artifacts: [gone] })
  const theirs = baseThread({ artifacts: [live] })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) throw new Error('expected the merge to refuse')
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, `artifacts[${ULID_C}]`)
})

test('merge.a-one-sided-risk-removal-conflicts-rather-than-losing', () => {
  const live = { id: ULID_C, scope: 'merge', text: 'a risk', refs: [], retired: false }
  const gone = { ...live, retired: true }
  const base = baseThread()
  const ours = baseThread({ spine: { ...baseSpine(), open_risks: [gone] } })
  const theirs = baseThread({ spine: { ...baseSpine(), open_risks: [live] } })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) throw new Error('expected the merge to refuse')
  assert.equal(result.conflicts.length, 1)
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, `spine.open_risks[${ULID_C}]`)
})

test('merge.every-declared-rule-path-is-written-by-the-merge', () => {
  const artifact = { id: ULID_C, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  const populated = (): Thread => baseThread({ predecessor_id: ULID_A, artifacts: [artifact] })

  const result = mergeThread(populated(), populated(), populated())

  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the merge to succeed')

  const written = [
    ...Object.keys(result.merged),
    ...Object.keys(result.merged.spine).map((key) => `spine.${key}`)
  ]
  const declared = Object.keys(THREAD_RULES)

  census(declared, (path) => (written.includes(path) ? 'allowed' : 'unclassifiable'))
  census(written, (path) => (path in THREAD_RULES ? 'allowed' : 'unclassifiable'))
  census(mergedThreadFieldPaths(), (path) => (written.includes(path) ? 'allowed' : 'unclassifiable'))
})

test('merge.a-thread-with-no-artifacts-gains-no-artifacts-key', () => {
  const result = mergeThread(baseThread(), baseThread(), baseThread())

  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the merge to succeed')
  assert.equal('artifacts' in result.merged, false)
})

test('merge.rule-table-is-covered.walk-finds-spine-and-top-level-paths', () => {
  const paths = walkThreadRulePaths(ThreadRecord.jsonSchema)
  assert.deepEqual(
    [...paths].sort(),
    [
      'artifacts',
      'blocked_by',
      'completion_criteria',
      'created_at',
      'id',
      'predecessor_id',
      'slug',
      'spine',
      'spine.active_goal',
      'spine.key_decisions',
      'spine.landed',
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
