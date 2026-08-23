import test from 'node:test'
import assert from 'node:assert/strict'
import { testRuntime } from '../support/runtime.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Thread, Criterion } from '../../src/schema/thread.ts'
import { CRITERIA_MAX_ELEMENTS, CRITERION_TEXT_MAX } from '../../src/schema/caps.ts'
import { evaluateDoneGate } from '../../src/domain/done-gate.ts'
import { insertCriterion, rewriteCriterion, strikeCriterion } from '../../src/domain/criteria.ts'
import type { DecisionResolver } from '../../src/domain/criteria.ts'

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
const CROCKFORD_ALPHABET_PATTERN = /^[0-9A-HJKMNP-TV-Z]+$/

const makeCriterion = (rt: Runtime, ordinal: number, text: string): Criterion => ({
  id: rt.ulid(),
  ordinal,
  text,
  done: false,
  kind: 'planned',
  struck_by: null
})

const makeThread = (rt: Runtime, criteria: Criterion[]): Thread => ({
  id: rt.ulid(),
  slug: 'criteria-test-thread',
  title: 'Criteria test thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: criteria,
  spine: {
    active_goal: 'amend criteria only through a resolving decision',
    next_step: 'write the tests',
    last_session: 'read the sibling modules',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const resolverFor = (knownId: string): DecisionResolver => (id) => id === knownId

const alwaysUnresolved: DecisionResolver = () => false

test('criteria.requires-decision-ref', () => {
  const rt = testRuntime()
  const known = rt.ulid()
  const unknown = rt.ulid()
  const resolve = resolverFor(known)
  const existing = makeCriterion(rt, 1, 'the existing criterion')
  const thread = makeThread(rt, [existing])

  const insertMissing = insertCriterion(rt, thread, { text: 'a new criterion', kind: 'planned', decisionId: undefined }, resolve)
  assert.equal(insertMissing.ok, false)
  assert.equal((insertMissing as { field: string }).field, 'criteria.insert.decision_id')

  const insertUnresolved = insertCriterion(rt, thread, { text: 'a new criterion', kind: 'planned', decisionId: unknown }, alwaysUnresolved)
  assert.equal(insertUnresolved.ok, false)
  assert.equal((insertUnresolved as { field: string }).field, 'criteria.insert.decision_id')

  const rewriteMissing = rewriteCriterion(rt, thread, { criterionId: existing.id, text: 'rewritten text', decisionId: null }, resolve)
  assert.equal(rewriteMissing.ok, false)
  assert.equal((rewriteMissing as { field: string }).field, 'criteria.rewrite.decision_id')

  const rewriteUnresolved = rewriteCriterion(
    rt,
    thread,
    { criterionId: existing.id, text: 'rewritten text', decisionId: unknown },
    alwaysUnresolved
  )
  assert.equal(rewriteUnresolved.ok, false)
  assert.equal((rewriteUnresolved as { field: string }).field, 'criteria.rewrite.decision_id')

  const strikeMissing = strikeCriterion(rt, thread, { criterionId: existing.id, decisionId: '' }, resolve)
  assert.equal(strikeMissing.ok, false)
  assert.equal((strikeMissing as { field: string }).field, 'criteria.strike.decision_id')

  const strikeUnresolved = strikeCriterion(rt, thread, { criterionId: existing.id, decisionId: unknown }, alwaysUnresolved)
  assert.equal(strikeUnresolved.ok, false)
  assert.equal((strikeUnresolved as { field: string }).field, 'criteria.strike.decision_id')

  assert.deepStrictEqual(thread.completion_criteria, [existing])
})

test('criteria.strike-retains', () => {
  const rt = testRuntime()
  const decisionId = rt.ulid()
  const resolve = resolverFor(decisionId)
  const keep = makeCriterion(rt, 1, 'keep me open')
  const target = makeCriterion(rt, 2, 'strike me')
  const thread = makeThread(rt, [keep, target])

  const result = strikeCriterion(rt, thread, { criterionId: target.id, decisionId }, resolve)
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  const struck = result.value

  const found = struck.completion_criteria.find((criterion) => criterion.id === target.id)
  assert.ok(found !== undefined)
  assert.equal(found?.struck_by, decisionId)
  assert.equal(struck.completion_criteria.length, thread.completion_criteria.length)

  const gate = evaluateDoneGate(struck, 'a closure statement')
  assert.ok('reason' in gate)
  if ('reason' in gate) {
    const outstandingIds = gate.outstanding.map((criterion) => criterion.id)
    assert.ok(!outstandingIds.includes(target.id))
    assert.ok(outstandingIds.includes(keep.id))
  }

  const rereadFound = struck.completion_criteria.find((criterion) => criterion.id === target.id)
  assert.ok(rereadFound !== undefined)
  assert.equal(rereadFound?.text, target.text)
})

test('criteria.ordinals-recompute', () => {
  const rt = testRuntime()
  const decisionId = rt.ulid()
  const resolve = resolverFor(decisionId)
  const first = makeCriterion(rt, 1, 'first criterion')
  const second = makeCriterion(rt, 2, 'second criterion')
  const thread = makeThread(rt, [first, second])

  const result = insertCriterion(
    rt,
    thread,
    { text: 'inserted between the two', kind: 'detour', decisionId, position: 1 },
    resolve
  )
  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  const next = result.value

  assert.equal(next.completion_criteria.length, 3)

  const originalIds = new Set([first.id, second.id])
  const insertedCriterion = next.completion_criteria.find((criterion) => !originalIds.has(criterion.id))
  assert.ok(insertedCriterion !== undefined)

  const nextIds = new Set(next.completion_criteria.map((criterion) => criterion.id))
  const expectedIds = new Set([first.id, second.id, insertedCriterion?.id])
  assert.deepStrictEqual(nextIds, expectedIds)

  const ordinals = next.completion_criteria.map((criterion) => criterion.ordinal)
  assert.deepStrictEqual(ordinals, [1, 2, 3])

  assert.equal(next.completion_criteria[0]?.id, first.id)
  assert.equal(next.completion_criteria[1]?.id, insertedCriterion?.id)
  assert.equal(next.completion_criteria[2]?.id, second.id)

  assert.ok(insertedCriterion !== undefined)
  const insertedId = insertedCriterion?.id as string
  assert.equal(insertedId.length, 26)
  assert.match(insertedId, ULID_PATTERN)
  assert.match(insertedId, CROCKFORD_ALPHABET_PATTERN)
  assert.notEqual(insertedId, first.id)
  assert.notEqual(insertedId, second.id)

  assert.ok(insertedCriterion !== undefined && insertedCriterion.text.length <= CRITERION_TEXT_MAX)
  assert.ok(thread.completion_criteria.length <= CRITERIA_MAX_ELEMENTS)
})
