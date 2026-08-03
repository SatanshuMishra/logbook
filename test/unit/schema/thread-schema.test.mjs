import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateThread,
  assertValidThread,
  SchemaValidationError,
} from '../../../src/schema/validators.mjs';

function makeValidThread() {
  return {
    schema_version: 2,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    slug: 'my-thread',
    title: 'My Thread',
    status: 'active',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [
      { id: 'c1', text: 'ship it', done: false, kind: 'planned', struck_by: null },
    ],
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

test('schema_version must be the constant 2, not 1', () => {
  const { valid, errors } = validateThread({ ...makeValidThread(), schema_version: 1 });
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

test('each completion_criteria item is closed and requires id, text, done, kind and struck_by', () => {
  const base = makeValidThread();
  const criterion = base.completion_criteria[0];
  for (const field of ['id', 'text', 'done', 'kind', 'struck_by']) {
    const { [field]: _dropped, ...missing } = criterion;
    assert.equal(
      validateThread({ ...base, completion_criteria: [missing] }).valid,
      false,
      `expected a missing ${field} to be rejected`,
    );
  }
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ ...criterion, note: 1 }] }).valid,
    false,
  );
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ ...criterion, text: '' }] }).valid,
    false,
  );
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ ...criterion, text: 'x'.repeat(201) }] }).valid,
    false,
  );
});

test('a completion_criteria id must match ^c[1-9][0-9]*$', () => {
  const base = makeValidThread();
  const criterion = base.completion_criteria[0];
  for (const id of ['c1', 'c2', 'c10', 'c137']) {
    assert.equal(validateThread({ ...base, completion_criteria: [{ ...criterion, id }] }).valid, true, id);
  }
  for (const id of ['c0', 'c01', '1', 'C1', 'c-1', 'thread', '']) {
    assert.equal(validateThread({ ...base, completion_criteria: [{ ...criterion, id }] }).valid, false, id);
  }
});

test('a completion_criteria kind is planned or detour and nothing else', () => {
  const base = makeValidThread();
  const criterion = base.completion_criteria[0];
  assert.equal(validateThread({ ...base, completion_criteria: [{ ...criterion, kind: 'planned' }] }).valid, true);
  assert.equal(validateThread({ ...base, completion_criteria: [{ ...criterion, kind: 'detour' }] }).valid, true);
  assert.equal(validateThread({ ...base, completion_criteria: [{ ...criterion, kind: 'child' }] }).valid, false);
});

test('struck_by is null or a NNNN-slug decision ref', () => {
  const base = makeValidThread();
  const criterion = base.completion_criteria[0];
  assert.equal(validateThread({ ...base, completion_criteria: [{ ...criterion, struck_by: null }] }).valid, true);
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ ...criterion, struck_by: '0021-detours' }] }).valid,
    true,
  );
  assert.equal(
    validateThread({ ...base, completion_criteria: [{ ...criterion, struck_by: 'detours' }] }).valid,
    false,
  );
});

test('an empty completion_criteria array is accepted — the definition of done gates opening, not the record', () => {
  const { valid, errors } = validateThread({ ...makeValidThread(), completion_criteria: [] });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
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
