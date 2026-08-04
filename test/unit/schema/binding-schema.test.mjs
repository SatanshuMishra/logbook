import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBinding,
  assertValidBinding,
  SchemaValidationError,
} from '../../../src/schema/validators.mjs';

function makeValidBinding() {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FBW',
    repo: 'my-repo',
    branch: 'feat/x',
    status: 'active',
    created_at: '2026-07-14T10:00:00Z',
    closed_at: null,
    closed_reason: null,
    first_commit: null,
    trailer_present: false,
  };
}

test('a fully-formed binding validates', () => {
  const { valid, errors } = validateBinding(makeValidBinding());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('an unknown field is rejected (additionalProperties false)', () => {
  const { valid, errors } = validateBinding({ ...makeValidBinding(), head_sha: 'abc' });
  assert.equal(valid, false);
  assert.equal(errors[0].keyword, 'additionalProperties');
});

test('id and thread_id must be ULIDs', () => {
  assert.equal(validateBinding({ ...makeValidBinding(), id: 'nope' }).valid, false);
  assert.equal(validateBinding({ ...makeValidBinding(), thread_id: 'nope' }).valid, false);
});

test('repo and branch must be non-empty', () => {
  assert.equal(validateBinding({ ...makeValidBinding(), repo: '' }).valid, false);
  assert.equal(validateBinding({ ...makeValidBinding(), branch: '' }).valid, false);
});

test('status must be one of active|merged|orphaned|abandoned', () => {
  assert.equal(validateBinding({ ...makeValidBinding(), status: 'active' }).valid, true);
  assert.equal(validateBinding({ ...makeValidBinding(), status: 'paused' }).valid, false);
});

test('closed_reason accepts null or an enum value only', () => {
  const base = makeValidBinding();
  assert.equal(validateBinding({ ...base, closed_reason: null }).valid, true);
  assert.equal(validateBinding({ ...base, closed_reason: 'merged' }).valid, true);
  assert.equal(validateBinding({ ...base, closed_reason: 'superseded' }).valid, true);
  assert.equal(validateBinding({ ...base, closed_reason: 'nope' }).valid, false);
});

test('first_commit and closed_at accept string or null', () => {
  const base = makeValidBinding();
  assert.equal(validateBinding({ ...base, first_commit: 'deadbeef' }).valid, true);
  assert.equal(validateBinding({ ...base, first_commit: null }).valid, true);
  assert.equal(validateBinding({ ...base, closed_at: '2026-07-14T11:00:00Z' }).valid, true);
  assert.equal(validateBinding({ ...base, closed_at: null }).valid, true);
});

test('trailer_present must be a boolean', () => {
  assert.equal(validateBinding({ ...makeValidBinding(), trailer_present: 'yes' }).valid, false);
});

test('assertValidBinding returns the record on success', () => {
  const b = makeValidBinding();
  assert.equal(assertValidBinding(b), b);
});

test('assertValidBinding throws SchemaValidationError with recordKind BranchBinding', () => {
  assert.throws(
    () => assertValidBinding({ ...makeValidBinding(), status: 'nope' }),
    (err) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.equal(err.recordKind, 'BranchBinding');
      assert.match(err.message, /^\w+: BranchBinding\./);
      return true;
    },
  );
});
