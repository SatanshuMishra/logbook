import test from 'node:test'
import assert from 'node:assert/strict'
import { testRuntime } from '../support/runtime.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Thread, Criterion } from '../../src/schema/thread.ts'
import { evaluateDoneGate } from '../../src/domain/done-gate.ts'
import { transition } from '../../src/domain/lifecycle.ts'

const ULID_IN_TEXT = /[0-9A-HJKMNP-TV-Z]{26}/g

const makeCriterion = (
  rt: Runtime,
  ordinal: number,
  text: string,
  done: boolean,
  struckBy: string | null = null
): Criterion => ({
  id: rt.ulid(),
  ordinal,
  text,
  done,
  kind: 'planned',
  struck_by: struckBy
})

const makeThread = (rt: Runtime, criteria: Criterion[]): Thread => ({
  id: rt.ulid(),
  slug: 'gate-test-thread',
  title: 'Gate test thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: criteria,
  spine: {
    active_goal: 'ship the done gate',
    next_step: 'close it out',
    last_session: 'wrote the gate',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

test('gate.requires-a-criterion', () => {
  const rt = testRuntime()
  const strikeId = rt.ulid()
  const criteria = [
    makeCriterion(rt, 1, 'ship the thing', true, strikeId),
    makeCriterion(rt, 2, 'ship the other thing', false, strikeId)
  ]
  const thread = makeThread(rt, criteria)

  const result = evaluateDoneGate(thread, 'a closure statement')

  assert.ok('reason' in result)
  if ('reason' in result) {
    assert.equal(result.reason, 'no-criteria')
    assert.deepStrictEqual(result.outstanding, [])
  }
})

test('gate.requires-all-done', () => {
  const rt = testRuntime()
  const criteria = [
    makeCriterion(rt, 1, 'the finished one', true),
    makeCriterion(rt, 2, 'the unfinished one', false)
  ]
  const thread = makeThread(rt, criteria)

  const result = evaluateDoneGate(thread, 'a closure statement')

  assert.ok('reason' in result)
  if ('reason' in result) {
    assert.equal(result.reason, 'criteria-open')
    assert.equal(result.outstanding.length, 1)
    assert.equal(result.outstanding[0]?.id, criteria[1]?.id)
  }
})

test('gate.requires-closure', () => {
  const rt = testRuntime()
  const criteria = [
    makeCriterion(rt, 1, 'the finished one', true),
    makeCriterion(rt, 2, 'the other finished one', true)
  ]
  const thread = makeThread(rt, criteria)

  const result = evaluateDoneGate(thread, '')

  assert.ok('reason' in result)
  if ('reason' in result) {
    assert.equal(result.reason, 'no-closure')
  }
})

test('gate.names-every-outstanding', () => {
  const rt = testRuntime()
  const openOne = makeCriterion(rt, 1, 'write the failing test first', false)
  const openTwo = makeCriterion(rt, 2, 'implement the gate to green', false)
  const openThree = makeCriterion(rt, 3, 'run the inertness mutation', false)
  const finishedNotOutstanding = makeCriterion(rt, 4, 'read the pinned interfaces', true)
  const struckNotOutstanding = makeCriterion(rt, 5, 'design a fourth lifecycle state', false, rt.ulid())
  const criteria = [openOne, openTwo, openThree, finishedNotOutstanding, struckNotOutstanding]
  const thread = makeThread(rt, criteria)

  const result = transition(rt, thread, 'done', 'a valid closure statement')

  assert.equal(result.ok, false)

  const foundIds = Array.from(new Set(result.message.match(ULID_IN_TEXT) ?? [])).sort()
  const expectedIds = [openOne.id, openTwo.id, openThree.id].sort()
  assert.deepStrictEqual(foundIds, expectedIds)

  assert.ok(result.message.includes(openOne.text))
  assert.ok(result.message.includes(openTwo.text))
  assert.ok(result.message.includes(openThree.text))

  assert.ok(!result.message.includes(finishedNotOutstanding.id))
  assert.ok(!result.message.includes(struckNotOutstanding.id))
})

test('gate.refusal-leaves-state', () => {
  const rt = testRuntime()
  const criteria = [makeCriterion(rt, 1, 'the unfinished one', false)]
  const thread = makeThread(rt, criteria)
  const snapshot = JSON.parse(JSON.stringify(thread)) as Thread

  const result = transition(rt, thread, 'done', 'a valid closure statement')

  assert.equal(result.ok, false)
  assert.deepStrictEqual(thread, snapshot)
  assert.equal(thread.status, snapshot.status)
  assert.equal(thread.updated_at, snapshot.updated_at)
})
