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
    'COUNT_CAPPED_ARRAY_FIELDS',
    'assertSpineCaps',
    'CapViolationError',
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
  const t = model.newThread({ title: 'End To End' }, { now: () => '2026-07-15T10:00:00Z' });
  assert.equal(validateThread(t).valid, true);
  const b = model.newBinding(
    { thread_id: t.id, repo: 'r', branch: 'feat/x' },
    { now: () => '2026-07-15T10:00:00Z' },
  );
  assert.equal(validateBinding(b).valid, true);
  assert.equal(b.thread_id, t.id);
});

test('fsm and caps helpers are reachable through the barrel', () => {
  assert.equal(model.isTerminal('done'), true);
  assert.equal(model.canTransition('active', 'done'), true);
  assert.equal(model.canTransition('blocked', 'abandoned'), false);
  assert.deepEqual(model.SPINE_CAPS, { scalarFieldMaxChars: 500, arrayMaxItems: 20, arrayItemMaxChars: 300 });
  assert.deepEqual([...model.COUNT_CAPPED_ARRAY_FIELDS], ['open_risks', 'out_of_scope']);
});
