import test from 'node:test'
import assert from 'node:assert/strict'
import { THREAD_RULES } from '../../src/merge/field-merge.ts'
import { census } from '../support/census.ts'
import { FIELD_HANDLING_TABLE, INDEXED_FIELD_PATTERN } from '../../src/server/tools/resolve_conflict.ts'
import type { Thread } from '../../src/schema/thread.ts'

const SAMPLE_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

const declaredPaths = (): (keyof typeof THREAD_RULES)[] => Object.keys(THREAD_RULES) as (keyof typeof THREAD_RULES)[]

test('resolve-conflict-fields.conflict-on-divergence-paths-have-scalar-handling', () => {
  const paths = declaredPaths().filter((path) => THREAD_RULES[path] === 'conflict-on-divergence')
  assert.ok(paths.length > 0)

  census(paths, (path) => (FIELD_HANDLING_TABLE[path].kind === 'scalar' ? 'allowed' : 'unclassifiable'))
})

test('resolve-conflict-fields.union-by-id-paths-have-indexed-handling-and-pattern-match', () => {
  const paths = declaredPaths().filter((path) => THREAD_RULES[path] === 'union-by-id')
  assert.ok(paths.length > 0)

  census(paths, (path) => {
    if (FIELD_HANDLING_TABLE[path].kind !== 'indexed') return 'unclassifiable'
    return INDEXED_FIELD_PATTERN.test(`${path}[${SAMPLE_ULID}]`) ? 'allowed' : 'unclassifiable'
  })
})

test('resolve-conflict-fields.spine-landed-is-classified-scalar', () => {
  assert.equal(FIELD_HANDLING_TABLE['spine.landed'].kind, 'scalar')
})

test('resolve-conflict-fields.artifacts-is-classified-indexed-and-pattern-matched', () => {
  assert.equal(FIELD_HANDLING_TABLE.artifacts.kind, 'indexed')
  assert.ok(INDEXED_FIELD_PATTERN.test(`artifacts[${SAMPLE_ULID}]`))
})

test('resolve-conflict-fields.bare-spine-array-form-is-no-longer-matched', () => {
  assert.equal(INDEXED_FIELD_PATTERN.test(`open_risks[${SAMPLE_ULID}]`), false)
  assert.ok(INDEXED_FIELD_PATTERN.test(`spine.open_risks[${SAMPLE_ULID}]`))
})

const RESOLVE_FIXTURE_THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAA'
const RESOLVE_FIXTURE_CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBB'
const RESOLVE_FIXTURE_TIME = '2026-09-14T00:00:00.000Z'

const resolveFixtureThread: Thread = {
  id: RESOLVE_FIXTURE_THREAD_ID,
  slug: 'resolve-fixture',
  title: 'resolve fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'resolve the fixture',
    next_step: 'resolve the fixture',
    landed: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: RESOLVE_FIXTURE_TIME,
  updated_at: RESOLVE_FIXTURE_TIME
}

test('resolve-conflict-fields.next-step-criterion-applies-an-id-and-removes-the-key-for-null', () => {
  const handling = FIELD_HANDLING_TABLE['spine.next_step_criterion_id']
  if (handling.kind !== 'scalar') throw new Error('expected scalar handling for spine.next_step_criterion_id')

  const anchored = handling.apply(resolveFixtureThread, RESOLVE_FIXTURE_CRITERION_ID)
  assert.equal(handling.read(anchored), RESOLVE_FIXTURE_CRITERION_ID)

  const cleared = handling.apply(anchored, null)
  assert.equal(handling.read(cleared), null)
  assert.equal('next_step_criterion_id' in cleared.spine, false, 'a null winner leaves no key, the shape a next step naming no criterion is stored in')
  assert.deepEqual(cleared.spine, resolveFixtureThread.spine)
})
