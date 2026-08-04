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
      open_risks: ['ci is flaky on the widget path'],
      key_decisions: ['0007-adopt-the-widget'],
      out_of_scope: ['widget docs'],
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

test('upcastThread leaves every field outside completion_criteria and spine untouched', () => {
  const v1 = makeV1Thread();
  const upcast = upcastThread(v1);
  const { schema_version: _sv, completion_criteria: _cc, spine: _sp, ...rest } = upcast;
  const { schema_version: _sv1, completion_criteria: _cc1, spine: _sp1, ...v1Rest } = v1;
  assert.deepEqual(rest, v1Rest);
});

test('upcastThread drops spine.status and seeds an empty last_session', () => {
  const spine = upcastThread(makeV1Thread()).spine;
  assert.equal('status' in spine, false);
  assert.equal(spine.last_session, '');
});

test('upcastThread turns every legacy risk string into a visible thread-scoped risk object', () => {
  const spine = upcastThread(makeV1Thread()).spine;
  assert.deepEqual(spine.open_risks, [
    { text: 'ci is flaky on the widget path', scope: 'thread', refs: [] },
  ]);
});

test('upcastThread turns every legacy decision slug into a hidden legacy-scoped decision object', () => {
  const spine = upcastThread(makeV1Thread()).spine;
  assert.deepEqual(spine.key_decisions, [
    { ref: '0007-adopt-the-widget', title: 'Adopt the widget', scope: 'legacy' },
  ]);
});

test('upcastThread carries out_of_scope and the remaining spine scalars through unchanged', () => {
  const spine = upcastThread(makeV1Thread()).spine;
  assert.deepEqual(spine.out_of_scope, ['widget docs']);
  assert.equal(spine.active_goal, 'g');
  assert.equal(spine.next_step, 'n');
});

test('upcastThread refuses a legacy risk or decision entry that is not a string', () => {
  const base = makeV1Thread();
  assert.throws(
    () => upcastThread(makeV1Thread({ spine: { ...base.spine, open_risks: [{ text: 'x' }] } })),
    /open_risks\[0\] must be a string/,
  );
  assert.throws(
    () => upcastThread(makeV1Thread({ spine: { ...base.spine, key_decisions: [7] } })),
    /key_decisions\[0\] must be a string/,
  );
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

test('an upcast v1 thread whose criterion text predates the 200-char cap still satisfies the v2 schema', () => {
  const overCap = makeV1Thread({
    completion_criteria: [{ text: 'c'.repeat(251), done: false }],
  });
  const { valid, errors } = validateThread(upcastThread(overCap));
  assert.equal(valid, true, JSON.stringify(errors));
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
