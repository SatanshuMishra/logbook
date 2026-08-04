import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../../src/model/index.mjs';
import { validateThread, validateBinding } from '../../../src/schema/index.mjs';

test('the barrel re-exports the full model surface', () => {
  for (const name of [
    'newThread',
    'newBinding',
    'ALLOWED_TRANSITIONS',
    'THREAD_STATUSES',
    'TERMINAL_STATUSES',
    'isTerminal',
    'canTransition',
    'checkDefinitionOfDone',
    'SPINE_CAPS',
    'assertSpineCaps',
    'CapViolationError',
    'liveCriteria',
    'resolveWriteScope',
  ]) {
    assert.ok(name in model, `expected export: ${name}`);
  }
  assert.equal(typeof model.newThread, 'function');
  assert.equal(typeof model.newBinding, 'function');
  assert.equal(typeof model.isTerminal, 'function');
  assert.equal(typeof model.canTransition, 'function');
  assert.equal(typeof model.checkDefinitionOfDone, 'function');
  assert.equal(typeof model.assertSpineCaps, 'function');
});

test('constructors from the barrel produce schema-valid records end-to-end', () => {
  const t = model.newThread({ title: 'End To End', completion_criteria: [{ text: 'ship it' }] }, { now: () => '2026-07-15T10:00:00Z' });
  assert.equal(validateThread(t).valid, true);
  const b = model.newBinding(
    { thread_id: t.id, repo: 'r', branch: 'feat/x' },
    { now: () => '2026-07-15T10:00:00Z' },
  );
  assert.equal(validateBinding(b).valid, true);
  assert.equal(b.thread_id, t.id);
});

test('fsm, caps and selection helpers are reachable through the barrel', () => {
  assert.equal(model.isTerminal('done'), true);
  assert.equal(model.canTransition('active', 'done'), true);
  assert.equal(model.canTransition('blocked', 'abandoned'), false);
  assert.equal(model.SPINE_CAPS.activeGoalMaxChars, 200);
  assert.equal(model.SPINE_CAPS.openRisksMaxPerScope, 20);
  assert.equal(
    model.resolveWriteScope({
      completion_criteria: [{ id: 'c1', done: true, struck_by: null }, { id: 'c2', done: false, struck_by: null }],
    }),
    'c2',
  );
});
