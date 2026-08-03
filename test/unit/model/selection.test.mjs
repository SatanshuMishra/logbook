import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCriteria, resolveWriteScope, criteriaProgress } from '../../../src/model/selection.mjs';

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

test('criteriaProgress counts planned criteria only, so a detour never moves the fraction', () => {
  const planned = thread([
    criterion('c1', { done: true }),
    criterion('c2', { done: true }),
    criterion('c3'),
  ]);
  assert.deepEqual(criteriaProgress(planned), { done: 2, total: 3, detoursOpen: 0 });

  const withDetour = thread([
    criterion('c1', { done: true }),
    criterion('c2', { done: true }),
    criterion('c4', { kind: 'detour' }),
    criterion('c3'),
  ]);
  assert.deepEqual(criteriaProgress(withDetour), { done: 2, total: 3, detoursOpen: 1 });
});

test('criteriaProgress excludes struck criteria from both the fraction and the detour count', () => {
  const t = thread([
    criterion('c1', { done: true }),
    criterion('c2', { struck_by: '0009-amendments' }),
    criterion('c3', { kind: 'detour', struck_by: '0009-amendments' }),
    criterion('c4'),
  ]);
  assert.deepEqual(criteriaProgress(t), { done: 1, total: 2, detoursOpen: 0 });
});

test('criteriaProgress counts only open detours', () => {
  const t = thread([
    criterion('c1', { kind: 'detour', done: true }),
    criterion('c2', { kind: 'detour' }),
    criterion('c3'),
  ]);
  assert.deepEqual(criteriaProgress(t), { done: 0, total: 1, detoursOpen: 1 });
});

test('criteriaProgress treats a v1 criterion carrying no kind as planned', () => {
  const t = { completion_criteria: [{ text: 'first', done: true }, { text: 'second', done: false }] };
  assert.deepEqual(criteriaProgress(t), { done: 1, total: 2, detoursOpen: 0 });
});

test('criteriaProgress returns a zero fraction for a thread with no criteria', () => {
  assert.deepEqual(criteriaProgress(thread([])), { done: 0, total: 0, detoursOpen: 0 });
  assert.deepEqual(criteriaProgress({}), { done: 0, total: 0, detoursOpen: 0 });
});
