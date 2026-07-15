import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateThread,
  assertValidThread,
  SchemaValidationError,
} from '../../../src/schema/validators.mjs';

function makeValidThread() {
  return {
    schema_version: 1,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    slug: 'my-thread',
    title: 'My Thread',
    status: 'active',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [{ text: 'ship it', done: false }],
    vcs_ref: null,
    external_refs: [{ system: 'linear', id: 'ABC-1', url: 'https://x/ABC-1' }],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      status: 'active',
      active_goal: 'g',
      next_step: 'n',
      open_risks: [],
      key_decisions: ['0001-adopt-x'],
      out_of_scope: [],
    },
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
  };
}

test('a fully-formed thread validates', () => {
  const { valid, errors } = validateThread(makeValidThread());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('an unknown top-level field is rejected (additionalProperties false)', () => {
  const { valid, errors } = validateThread({ ...makeValidThread(), bogus: 1 });
  assert.equal(valid, false);
  assert.equal(errors[0].keyword, 'additionalProperties');
});

test('schema_version must be the constant 1, not 2', () => {
  const { valid, errors } = validateThread({ ...makeValidThread(), schema_version: 2 });
  assert.equal(valid, false);
  assert.equal(errors[0].keyword, 'const');
});

test('id must match the 26-char ULID pattern', () => {
  const { valid, errors } = validateThread({ ...makeValidThread(), id: 'not-a-ulid' });
  assert.equal(valid, false);
  assert.equal(errors[0].keyword, 'pattern');
});

test('parent_id and predecessor_id accept null or a ULID', () => {
  const base = makeValidThread();
  assert.equal(validateThread({ ...base, parent_id: null }).valid, true);
  assert.equal(
    validateThread({ ...base, parent_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }).valid,
    true,
  );
  assert.equal(validateThread({ ...base, parent_id: 'nope' }).valid, false);
});

test('slug and title must be non-empty', () => {
  assert.equal(validateThread({ ...makeValidThread(), slug: '' }).valid, false);
  assert.equal(validateThread({ ...makeValidThread(), title: '' }).valid, false);
});

test('status must be one of the five enum values', () => {
  assert.equal(validateThread({ ...makeValidThread(), status: 'archived' }).valid, false);
});

test('spine is a closed object — an extra spine field is rejected', () => {
  const base = makeValidThread();
  const { valid, errors } = validateThread({
    ...base,
    spine: { ...base.spine, extra: 1 },
  });
  assert.equal(valid, false);
  assert.equal(errors[0].keyword, 'additionalProperties');
});

test('spine requires all six fields', () => {
  const base = makeValidThread();
  const { status, ...spineMissingStatus } = base.spine;
  assert.equal(validateThread({ ...base, spine: spineMissingStatus }).valid, false);
});

test('each completion_criteria item is closed and requires text and done', () => {
  const base = makeValidThread();
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ text: 'x' }] }).valid,
    false,
  );
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ text: 'x', done: true, note: 1 }] }).valid,
    false,
  );
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ text: '', done: false }] }).valid,
    false,
  );
});

test('an empty completion_criteria array is schema-valid', () => {
  assert.equal(validateThread({ ...makeValidThread(), completion_criteria: [] }).valid, true);
});

test('each external_refs item is closed and requires system, id, url', () => {
  const base = makeValidThread();
  assert.equal(
    validateThread({ ...base, external_refs: [{ system: 's', id: 'i' }] }).valid,
    false,
  );
  assert.equal(
    validateThread({ ...base, external_refs: [{ system: 's', id: 'i', url: 'u', x: 1 }] }).valid,
    false,
  );
});

test('created_at / updated_at must match the loose ISO pattern', () => {
  assert.equal(validateThread({ ...makeValidThread(), created_at: '14-07-2026' }).valid, false);
  assert.equal(
    validateThread({ ...makeValidThread(), created_at: '2026-07-14T10:00:00' }).valid,
    true,
  );
});

test('assertValidThread returns the record on success', () => {
  const t = makeValidThread();
  assert.equal(assertValidThread(t), t);
});

test('assertValidThread throws SchemaValidationError on failure', () => {
  assert.throws(
    () => assertValidThread({ ...makeValidThread(), status: 'nope' }),
    (err) => {
      assert.ok(err instanceof SchemaValidationError);
      assert.equal(err.recordKind, 'Thread');
      assert.ok(Array.isArray(err.errors) && err.errors.length > 0);
      assert.match(err.message, /Thread failed schema validation/);
      return true;
    },
  );
});
