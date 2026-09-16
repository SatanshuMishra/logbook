import { test } from 'node:test'
import assert from 'node:assert/strict'
import { differingJsonPaths } from '../../src/merge/json-differences.ts'

test('json-differences.equal-values-differ-nowhere', () => {
  const record = { id: 'T', spine: { active_goal: 'goal', open_risks: [{ id: 'R', text: 'risk' }] } }
  assert.deepEqual(differingJsonPaths(record, structuredClone(record)), [])
})

test('json-differences.names-the-nested-field-that-changed', () => {
  assert.deepEqual(
    differingJsonPaths(
      { title: 'same', spine: { active_goal: 'ana goal', next_step: 'same' } },
      { title: 'same', spine: { active_goal: 'ben goal', next_step: 'same' } }
    ),
    ['spine.active_goal']
  )
})

test('json-differences.names-a-field-present-on-only-one-side', () => {
  assert.deepEqual(differingJsonPaths({ a: 1 }, { a: 1, b: 2 }), ['b'])
  assert.deepEqual(differingJsonPaths({ a: 1, b: 2 }, { a: 1 }), ['b'])
})

test('json-differences.addresses-entries-of-an-id-keyed-list-by-their-id', () => {
  assert.deepEqual(
    differingJsonPaths(
      { completion_criteria: [{ id: 'X', text: 'kept' }, { id: 'Y', text: 'removed' }] },
      { completion_criteria: [{ id: 'X', text: 'reworded' }, { id: 'Z', text: 'added' }] }
    ),
    ['completion_criteria[X].text', 'completion_criteria[Y]', 'completion_criteria[Z]']
  )
})

test('json-differences.names-a-list-without-ids-as-one-path', () => {
  assert.deepEqual(differingJsonPaths({ options: ['a', 'b'] }, { options: ['a', 'c'] }), ['options'])
})

test('json-differences.names-the-root-when-the-values-are-not-both-objects', () => {
  assert.deepEqual(differingJsonPaths('one', 'two'), ['(root)'])
})
