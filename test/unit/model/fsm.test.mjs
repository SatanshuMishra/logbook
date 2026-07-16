import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THREAD_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  isTerminal,
  canTransition,
} from '../../../src/model/fsm.mjs';

test('ALLOWED_TRANSITIONS holds the verbatim continuity-ledger matrix', () => {
  assert.deepEqual(ALLOWED_TRANSITIONS, {
    active: ['paused', 'blocked', 'done', 'abandoned'],
    paused: ['active', 'done', 'abandoned'],
    blocked: ['active', 'paused'],
    done: [],
    abandoned: [],
  });
});

test('ALLOWED_TRANSITIONS and its rows are frozen', () => {
  assert.ok(Object.isFrozen(ALLOWED_TRANSITIONS));
  assert.ok(Object.isFrozen(ALLOWED_TRANSITIONS.active));
  assert.ok(Object.isFrozen(ALLOWED_TRANSITIONS.done));
});

test('THREAD_STATUSES lists the five states', () => {
  assert.deepEqual([...THREAD_STATUSES], ['active', 'paused', 'blocked', 'done', 'abandoned']);
});

test('TERMINAL_STATUSES are exactly done and abandoned', () => {
  assert.deepEqual([...TERMINAL_STATUSES], ['done', 'abandoned']);
});

test('isTerminal is true only for terminal states', () => {
  assert.equal(isTerminal('done'), true);
  assert.equal(isTerminal('abandoned'), true);
  assert.equal(isTerminal('active'), false);
  assert.equal(isTerminal('paused'), false);
  assert.equal(isTerminal('blocked'), false);
  assert.equal(isTerminal('nonsense'), false);
});

test('terminal states have no outgoing transitions', () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.done, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.abandoned, []);
});

test('canTransition allows every matrix edge', () => {
  assert.equal(canTransition('active', 'paused'), true);
  assert.equal(canTransition('active', 'blocked'), true);
  assert.equal(canTransition('active', 'done'), true);
  assert.equal(canTransition('active', 'abandoned'), true);
  assert.equal(canTransition('paused', 'active'), true);
  assert.equal(canTransition('paused', 'done'), true);
  assert.equal(canTransition('paused', 'abandoned'), true);
  assert.equal(canTransition('blocked', 'active'), true);
  assert.equal(canTransition('blocked', 'paused'), true);
});

test('canTransition refuses edges absent from the matrix', () => {
  assert.equal(canTransition('blocked', 'abandoned'), false);
  assert.equal(canTransition('blocked', 'done'), false);
  assert.equal(canTransition('active', 'active'), false);
  assert.equal(canTransition('paused', 'blocked'), false);
  assert.equal(canTransition('mystery', 'active'), false);
});

test('canTransition refuses transitions out of a terminal state', () => {
  assert.equal(canTransition('done', 'active'), false);
  assert.equal(canTransition('abandoned', 'active'), false);
});
