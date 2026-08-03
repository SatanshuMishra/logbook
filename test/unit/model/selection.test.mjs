import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCriteria, resolveWriteScope } from '../../../src/model/selection.mjs';

function criterion(id, overrides = {}) {
  return { id, text: id, done: false, kind: 'planned', struck_by: null, ...overrides };
}

function thread(criteria) {
  return { completion_criteria: criteria };
}

test('liveCriteria drops struck criteria and keeps array order', () => {
  const t = thread([
    criterion('c1'),
    criterion('c2', { struck_by: '0021-detours' }),
    criterion('c3'),
  ]);
  assert.deepEqual(liveCriteria(t).map((c) => c.id), ['c1', 'c3']);
});

test('resolveWriteScope is the first live criterion that is not done', () => {
  const t = thread([
    criterion('c1', { done: true }),
    criterion('c2', { struck_by: '0021-detours' }),
    criterion('c3'),
    criterion('c4'),
  ]);
  assert.equal(resolveWriteScope(t), 'c3');
});

test('resolveWriteScope falls back to the last live criterion once every one is done', () => {
  const t = thread([criterion('c1', { done: true }), criterion('c2', { done: true })]);
  assert.equal(resolveWriteScope(t), 'c2');
});

test('resolveWriteScope falls back to the thread scope when no live criterion exists', () => {
  assert.equal(resolveWriteScope(thread([])), 'thread');
  assert.equal(resolveWriteScope(thread([criterion('c1', { struck_by: '0021-detours' })])), 'thread');
  assert.equal(resolveWriteScope({}), 'thread');
});

test('resolveWriteScope never returns the legacy scope', () => {
  const t = thread([criterion('c1', { done: true }), criterion('c2')]);
  assert.notEqual(resolveWriteScope(t), 'legacy');
});
