import test from 'node:test';
import assert from 'node:assert/strict';
import { upcastThread } from '../../../src/schema/upcast.mjs';
import { validateThread } from '../../../src/schema/validators.mjs';

function makeV1Thread(overrides = {}) {
  return {
    schema_version: 1,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    slug: 'legacy-thread',
    title: 'Legacy Thread',
    status: 'paused',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [
      { text: 'first', done: true },
      { text: 'second', done: false },
    ],
    vcs_ref: null,
    external_refs: [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      status: 'paused',
      active_goal: 'g',
      next_step: 'n',
      open_risks: [],
      key_decisions: [],
      out_of_scope: [],
    },
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
    ...overrides,
  };
}

test('upcastThread rewrites schema_version 1 to 2', () => {
  assert.equal(upcastThread(makeV1Thread()).schema_version, 2);
});

test('upcastThread gives every v1 criterion a positional id, planned kind and null struck_by', () => {
  const upcast = upcastThread(makeV1Thread());
  assert.deepEqual(upcast.completion_criteria, [
    { id: 'c1', text: 'first', done: true, kind: 'planned', struck_by: null },
    { id: 'c2', text: 'second', done: false, kind: 'planned', struck_by: null },
  ]);
});

test('an upcast v1 thread satisfies the v2 schema', () => {
  const { valid, errors } = validateThread(upcastThread(makeV1Thread()));
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('upcastThread leaves every non-criteria field untouched', () => {
  const v1 = makeV1Thread();
  const upcast = upcastThread(v1);
  const { schema_version: _sv, completion_criteria: _cc, ...rest } = upcast;
  const { schema_version: _sv1, completion_criteria: _cc1, ...v1Rest } = v1;
  assert.deepEqual(rest, v1Rest);
});

test('upcastThread does not mutate the record it is given', () => {
  const v1 = makeV1Thread();
  upcastThread(v1);
  assert.deepEqual(v1, makeV1Thread());
});

test('upcastThread returns a v2 record unchanged', () => {
  const v2 = {
    ...makeV1Thread(),
    schema_version: 2,
    completion_criteria: [{ id: 'c7', text: 'kept', done: false, kind: 'detour', struck_by: null }],
  };
  assert.equal(upcastThread(v2), v2);
});

test('upcastThread carries an empty legacy completion_criteria through without throwing', () => {
  const upcast = upcastThread(makeV1Thread({ completion_criteria: [] }));
  assert.deepEqual(upcast.completion_criteria, []);
  assert.equal(upcast.schema_version, 2);
});

test('upcastThread never throws on an over-cap legacy scalar', () => {
  const overCap = makeV1Thread({
    spine: { ...makeV1Thread().spine, active_goal: 'a'.repeat(281) },
  });
  assert.equal(upcastThread(overCap).spine.active_goal.length, 281);
});

test('upcastThread returns null for an absent record', () => {
  assert.equal(upcastThread(null), null);
  assert.equal(upcastThread(undefined), null);
});

test('upcastThread refuses a record that is not an object', () => {
  assert.throws(() => upcastThread('not a thread'), /must be an object/);
  assert.throws(() => upcastThread([]), /must be an object/);
});

test('upcastThread refuses a legacy criterion that is not an object', () => {
  assert.throws(
    () => upcastThread(makeV1Thread({ completion_criteria: ['ship it'] })),
    /completion_criteria\[0\] must be an object/,
  );
});
