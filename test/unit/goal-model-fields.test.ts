import test from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { mergeThread } from '../../src/merge/field-merge.ts'

const THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ'
const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const ARTIFACT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0'

const legacyThreadShape = (): Record<string, unknown> => ({
  id: THREAD_ID,
  slug: 'a-legacy-thread',
  title: 'a thread written before this change',
  status: 'open',
  blocked_by: null,
  completion_criteria: [{ id: CRITERION_ID, ordinal: 1, text: 'ship it', done: false, kind: 'planned', struck_by: null }],
  spine: {
    active_goal: 'ship it',
    next_step: 'write the tests',
    landed: '',
    last_session: 'read the spec',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z'
})

test('goal-model.parsing-adds-no-bytes-to-a-record-written-before-this-change', () => {
  const shape = legacyThreadShape()
  const before = Buffer.byteLength(JSON.stringify(shape), 'utf8')
  const result = ThreadRecord.parse(shape)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(
    Buffer.byteLength(JSON.stringify(result.value), 'utf8'),
    before,
    'parsing must not grow a stored record; a record at the byte cap would otherwise become unwritable'
  )
})

test('goal-model.a-record-carrying-none-of-the-optional-goal-model-fields-still-parses', () => {
  const result = ThreadRecord.parse(legacyThreadShape())
  assert.equal(
    result.ok,
    true,
    'a stored record carrying no artifacts and no criterion check, result or result_status must still parse'
  )
  if (!result.ok) return
  assert.equal(result.value.artifacts, undefined)
  assert.equal(result.value.completion_criteria[0]?.check, undefined)
  assert.equal(result.value.completion_criteria[0]?.result, undefined)
  assert.equal(result.value.completion_criteria[0]?.result_status, undefined)
})

test('goal-model.a-criterion-carrying-check-result-and-status-round-trips', () => {
  const shape = legacyThreadShape()
  const criteria = shape.completion_criteria as Record<string, unknown>[]
  criteria[0] = {
    ...criteria[0],
    check: 'npm test exits 0',
    result: '436 tests, 0 fail, exit 0',
    result_status: 'verified'
  }
  const result = ThreadRecord.parse(shape)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.completion_criteria[0]?.check, 'npm test exits 0')
  assert.equal(result.value.completion_criteria[0]?.result, '436 tests, 0 fail, exit 0')
  assert.equal(result.value.completion_criteria[0]?.result_status, 'verified')
})

test('goal-model.result-status-accepts-only-the-two-recorded-states', () => {
  const shape = legacyThreadShape()
  const criteria = shape.completion_criteria as Record<string, unknown>[]
  criteria[0] = { ...criteria[0], result_status: 'probably-fine' }
  const result = ThreadRecord.parse(shape)
  assert.equal(result.ok, false, 'a result_status outside the two recorded states must be refused')
  if (result.ok) return
  assert.equal(result.field, 'completion_criteria.0.result_status')
})

test('goal-model.a-thread-carrying-artifacts-round-trips', () => {
  const result = ThreadRecord.parse({
    ...legacyThreadShape(),
    artifacts: [{ id: ARTIFACT_ID, label: 'the implementation plan', pointer: 'docs/plans/a-plan.md', retired: false }]
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.artifacts?.[0]?.label, 'the implementation plan')
  assert.equal(result.value.artifacts?.[0]?.pointer, 'docs/plans/a-plan.md')
})

const parsedThread = (): Thread => {
  const result = ThreadRecord.parse(legacyThreadShape())
  if (!result.ok) throw new Error(`goal-model fixture: the base thread failed to parse: ${result.message}`)
  return result.value
}

test('goal-model.criterion-kind-is-read-by-the-merge-and-a-divergence-conflicts', () => {
  const ours = parsedThread()
  const theirs: Thread = {
    ...ours,
    completion_criteria: ours.completion_criteria.map((criterion) => ({ ...criterion, kind: 'detour' }))
  }
  assert.equal(ours.completion_criteria[0]?.kind, 'planned')
  assert.equal(theirs.completion_criteria[0]?.kind, 'detour')
  assert.equal(
    isDeepStrictEqual(ours.completion_criteria, theirs.completion_criteria),
    false,
    'the fixture must differ in kind alone'
  )

  const merged = mergeThread(null, ours, theirs)
  assert.equal(merged.ok, false, 'two copies of one criterion differing only in kind must conflict, never silently pick one')
  if (merged.ok) return
  assert.equal(merged.conflicts.length, 1)
  assert.equal(merged.conflicts[0]?.field, `completion_criteria[${CRITERION_ID}]`)
})
