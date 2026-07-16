import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDefinitionOfDone } from '../../../src/model/dod.mjs';

function doneCandidate(overrides) {
  return {
    completion_criteria: [{ text: 'ship it', done: true }],
    closure_statement: 'shipped and verified',
    ...overrides,
  };
}

test('empty completion_criteria refuses done', () => {
  const result = checkDefinitionOfDone(doneCandidate({ completion_criteria: [] }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /completion_criteria/);
});

test('a missing/non-array completion_criteria refuses done', () => {
  const result = checkDefinitionOfDone(doneCandidate({ completion_criteria: undefined }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /completion_criteria/);
});

test('an unfinished criterion refuses done', () => {
  const result = checkDefinitionOfDone(doneCandidate({
    completion_criteria: [{ text: 'a', done: true }, { text: 'b', done: false }],
  }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /done/);
});

test('a null closure_statement refuses done', () => {
  const result = checkDefinitionOfDone(doneCandidate({ closure_statement: null }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /closure_statement/);
});

test('a whitespace-only closure_statement refuses done', () => {
  const result = checkDefinitionOfDone(doneCandidate({ closure_statement: '   ' }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /closure_statement/);
});

test('non-empty criteria all done plus a non-empty closure passes', () => {
  const result = checkDefinitionOfDone(doneCandidate());
  assert.deepEqual(result, { ok: true });
});
