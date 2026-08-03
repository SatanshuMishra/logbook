import test from 'node:test';
import assert from 'node:assert/strict';
import {
  liveCriteria,
  resolveWriteScope,
  selectCurrent,
  criteriaProgress,
} from '../../../src/model/selection.mjs';

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

test('selectCurrent picks the first live criterion that is not done', () => {
  const selection = selectCurrent(thread([
    criterion('c1', { done: true }),
    criterion('c2'),
    criterion('c3'),
  ]));
  assert.equal(selection.current.id, 'c2');
  assert.equal(selection.state, 'in-progress');
  assert.equal(selection.done, 1);
  assert.equal(selection.total, 3);
});

test('selectCurrent reports ready-to-close once every live criterion is done', () => {
  const selection = selectCurrent(thread([
    criterion('c1', { done: true }),
    criterion('c2', { done: true }),
  ]));
  assert.equal(selection.current, null);
  assert.equal(selection.state, 'ready-to-close');
  assert.equal(selection.done, 2);
  assert.equal(selection.total, 2);
});

test('selectCurrent skips a struck criterion when choosing the current one', () => {
  const selection = selectCurrent(thread([
    criterion('c1', { done: true }),
    criterion('c2', { struck_by: '0021-drop-the-step' }),
    criterion('c3'),
  ]));
  assert.equal(selection.current.id, 'c3');
  assert.equal(selection.done, 1);
  assert.equal(selection.total, 2);
});

test('an open detour never moves the done/total fraction', () => {
  const planned = [
    criterion('c1', { done: true }),
    criterion('c2', { done: true }),
    criterion('c3', { done: true }),
    criterion('c4'),
    criterion('c5'),
    criterion('c6'),
  ];
  const before = selectCurrent(thread(planned));
  assert.equal(before.done, 3);
  assert.equal(before.total, 6);
  assert.equal(before.detoursOpen, 0);

  const withDetour = selectCurrent(thread([
    ...planned.slice(0, 3),
    criterion('c7', { kind: 'detour' }),
    ...planned.slice(3),
  ]));
  assert.equal(withDetour.done, 3);
  assert.equal(withDetour.total, 6);
  assert.equal(withDetour.detoursOpen, 1);
  assert.equal(withDetour.current.id, 'c7');
});

test('a closed detour is not counted as open', () => {
  const selection = selectCurrent(thread([
    criterion('c1', { kind: 'detour', done: true }),
    criterion('c2'),
  ]));
  assert.equal(selection.detoursOpen, 0);
  assert.equal(selection.current.id, 'c2');
});

test('visibleScopes is the current criterion plus the thread scope', () => {
  const selection = selectCurrent(thread([
    criterion('c1', { done: true }),
    criterion('c2'),
    criterion('c3'),
  ]));
  assert.deepEqual([...selection.visibleScopes].sort(), ['c2', 'thread']);
});

test('visibleScopes anchors on the last live criterion once the thread is ready to close', () => {
  const selection = selectCurrent(thread([
    criterion('c1', { done: true }),
    criterion('c2', { done: true }),
    criterion('c3', { done: true, struck_by: '0021-drop-the-step' }),
  ]));
  assert.deepEqual([...selection.visibleScopes].sort(), ['c2', 'thread']);
});

test('visibleScopes never contains the legacy scope', () => {
  for (const t of [
    thread([criterion('c1')]),
    thread([criterion('c1', { done: true })]),
    thread([criterion('c1', { struck_by: '0021-drop-the-step' })]),
    thread([]),
  ]) {
    assert.equal(selectCurrent(t).visibleScopes.has('legacy'), false);
  }
});

test('selectCurrent degrades to the thread scope alone when no live criterion exists', () => {
  const selection = selectCurrent(thread([]));
  assert.equal(selection.current, null);
  assert.equal(selection.state, 'ready-to-close');
  assert.equal(selection.total, 0);
  assert.deepEqual([...selection.visibleScopes], ['thread']);
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
