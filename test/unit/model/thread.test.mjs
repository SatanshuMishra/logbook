import test from 'node:test';
import assert from 'node:assert/strict';
import { isoNow } from '../../../src/model/clock.mjs';
import { newThread } from '../../../src/model/thread.mjs';
import { CapViolationError } from '../../../src/model/caps.mjs';
import { validateThread } from '../../../src/schema/index.mjs';

const FIXED = '2026-07-15T10:00:00Z';
const fixedClock = () => FIXED;
const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PARENT = '01ARZ3NDEKTSV4RRFFQ69G5FBW';
const ISO_LOOSE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/;
const DOD = [{ text: 'ship it' }];

test('isoNow returns an injected clock function value', () => {
  assert.equal(isoNow(fixedClock), FIXED);
});

test('isoNow returns an injected string as-is', () => {
  assert.equal(isoNow(FIXED), FIXED);
});

test('isoNow defaults to a wall-clock ISO string', () => {
  const value = isoNow(undefined);
  assert.equal(typeof value, 'string');
  assert.match(value, ISO_LOOSE);
});

test('isoNow rejects a clock returning a non-string', () => {
  assert.throws(() => isoNow(() => 42), /ISO string/);
});

test('newThread builds a schema-valid active thread from a title', () => {
  const t = newThread({ title: 'My Thread', completion_criteria: DOD }, { now: fixedClock, id: ID });
  assert.equal(validateThread(t).valid, true);
  assert.equal(t.schema_version, 2);
  assert.equal(t.id, ID);
  assert.equal(t.status, 'active');
  assert.equal(t.slug, 'my-thread');
  assert.equal(t.title, 'My Thread');
  assert.equal(t.parent_id, null);
  assert.equal(t.predecessor_id, null);
  assert.deepEqual(t.completion_criteria, [
    { id: 'c1', text: 'ship it', done: false, kind: 'planned', struck_by: null },
  ]);
  assert.equal(t.vcs_ref, null);
  assert.deepEqual(t.external_refs, []);
  assert.equal(t.blocked_by, null);
  assert.equal(t.abandoned_reason, null);
  assert.equal(t.closure_statement, null);
  assert.deepEqual(t.spine, {
    active_goal: '', next_step: '', last_session: '',
    open_risks: [], key_decisions: [], out_of_scope: [],
  });
});

test('newThread stamps created_at and updated_at from the injected clock', () => {
  const t = newThread({ title: 'x', completion_criteria: DOD }, { now: fixedClock, id: ID });
  assert.equal(t.created_at, FIXED);
  assert.equal(t.updated_at, FIXED);
});

test('newThread defaults its id to a fresh ULID when none is injected', () => {
  const t = newThread({ title: 'x', completion_criteria: DOD }, { now: fixedClock });
  assert.match(t.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('newThread keeps an explicit non-empty slug', () => {
  const t = newThread({ title: 'My Thread', slug: 'custom-slug', completion_criteria: DOD }, { now: fixedClock, id: ID });
  assert.equal(t.slug, 'custom-slug');
});

test('newThread allocates c1..cN ids, defaults kind to planned and struck_by to null', () => {
  const t = newThread(
    { title: 'x', completion_criteria: [{ text: 'a' }, { text: 'b', kind: 'detour' }, { text: 'c' }] },
    { now: fixedClock, id: ID },
  );
  assert.equal(validateThread(t).valid, true);
  assert.deepEqual(t.completion_criteria, [
    { id: 'c1', text: 'a', done: false, kind: 'planned', struck_by: null },
    { id: 'c2', text: 'b', done: false, kind: 'detour', struck_by: null },
    { id: 'c3', text: 'c', done: false, kind: 'planned', struck_by: null },
  ]);
});

test('newThread refuses a thread with no definition of done', () => {
  assert.throws(
    () => newThread({ title: 'x' }, { now: fixedClock, id: ID }),
    /completion_criteria/,
  );
  assert.throws(
    () => newThread({ title: 'x', completion_criteria: [] }, { now: fixedClock, id: ID }),
    /completion_criteria/,
  );
});

function refusalOf(build) {
  try {
    build();
  } catch (error) {
    return error;
  }
  return assert.fail('expected the call to be refused');
}

test('a thread opened with no definition of done names empty_criteria at the tool layer', () => {
  for (const criteria of [undefined, []]) {
    const error = refusalOf(() => newThread(
      { title: 'x', completion_criteria: criteria },
      { now: fixedClock, id: ID, tool: 'open_thread' },
    ));
    assert.equal(error.code, 'empty_criteria');
    assert.equal(error.layer, 'tool');
    assert.equal(error.field, 'open_thread.completion_criteria');
    assert.equal(error.retryable, false);
  }
});

test('a title that yields no slug names underivable_slug at the tool layer', () => {
  const error = refusalOf(() => newThread(
    { title: '日本語', completion_criteria: DOD },
    { now: fixedClock, id: ID, tool: 'open_thread' },
  ));
  assert.equal(error.code, 'underivable_slug');
  assert.equal(error.layer, 'tool');
  assert.equal(error.field, 'open_thread.title');
});

test('a blank title names blank_parameter at the tool layer', () => {
  const error = refusalOf(() => newThread(
    { title: '   ', completion_criteria: DOD },
    { now: fixedClock, id: ID, tool: 'open_thread' },
  ));
  assert.equal(error.code, 'blank_parameter');
  assert.equal(error.layer, 'tool');
  assert.equal(error.field, 'open_thread.title');
});

test('an over-cap criterion is refused as a CapViolationError carrying the field it indexes', () => {
  let thrown = null;
  try {
    newThread(
      { title: 'x', completion_criteria: [{ text: 'a' }, { text: 'c'.repeat(201) }] },
      { now: fixedClock, id: ID },
    );
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof CapViolationError, `expected CapViolationError, got ${thrown?.name}`);
  assert.equal(thrown.name, 'CapViolationError');
  assert.equal(thrown.code, 'cap_exceeded');
  assert.equal(thrown.layer, 'cap');
  assert.deepEqual(thrown.fields, ['completion_criteria[1].text']);
  assert.equal(thrown.toDetail().error, 'CapViolationError');
});

test('newThread refuses a criterion text over 200 chars', () => {
  assert.throws(
    () => newThread(
      { title: 'x', completion_criteria: [{ text: 'c'.repeat(201) }] },
      { now: fixedClock, id: ID },
    ),
    /completion_criteria\[0\]\.text: at most 200 characters/,
  );
  const ok = newThread(
    { title: 'x', completion_criteria: [{ text: 'c'.repeat(200) }] },
    { now: fixedClock, id: ID },
  );
  assert.equal(ok.completion_criteria[0].text.length, 200);
});

test('newThread passes through parent_id, predecessor_id, vcs_ref and external_refs', () => {
  const refs = [{ system: 'linear', id: 'ABC-1', url: 'https://x/ABC-1' }];
  const t = newThread(
    {
      title: 'x',
      parent_id: PARENT,
      predecessor_id: PARENT,
      vcs_ref: 'feat/x',
      external_refs: refs,
      completion_criteria: DOD,
    },
    { now: fixedClock, id: ID },
  );
  assert.equal(validateThread(t).valid, true);
  assert.equal(t.parent_id, PARENT);
  assert.equal(t.predecessor_id, PARENT);
  assert.equal(t.vcs_ref, 'feat/x');
  assert.deepEqual(t.external_refs, refs);
});

test('newThread does not mutate its input fields', () => {
  const fields = { title: 'x', completion_criteria: [{ text: 'a' }] };
  newThread(fields, { now: fixedClock, id: ID });
  assert.deepEqual(fields, { title: 'x', completion_criteria: [{ text: 'a' }] });
});

test('newThread throws on a missing or blank title', () => {
  assert.throws(() => newThread({ completion_criteria: DOD }, { now: fixedClock }), /title/);
  assert.throws(() => newThread({ title: '   ', completion_criteria: DOD }, { now: fixedClock }), /title/);
});

test('newThread throws when no slug can be derived and none is supplied', () => {
  assert.throws(() => newThread({ title: '!!!', completion_criteria: DOD }, { now: fixedClock }), /slug/);
});
