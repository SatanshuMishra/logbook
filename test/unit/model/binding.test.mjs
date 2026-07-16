import test from 'node:test';
import assert from 'node:assert/strict';
import { newBinding } from '../../../src/model/binding.mjs';
import { validateBinding } from '../../../src/schema/index.mjs';

const FIXED = '2026-07-15T10:00:00Z';
const fixedClock = () => FIXED;
const BID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TID = '01ARZ3NDEKTSV4RRFFQ69G5FBW';

function base(overrides) {
  return { thread_id: TID, repo: 'my-repo', branch: 'feat/x', ...overrides };
}

test('newBinding builds a schema-valid active binding', () => {
  const b = newBinding(base(), { now: fixedClock, id: BID });
  assert.equal(validateBinding(b).valid, true);
  assert.equal(b.id, BID);
  assert.equal(b.thread_id, TID);
  assert.equal(b.repo, 'my-repo');
  assert.equal(b.branch, 'feat/x');
  assert.equal(b.status, 'active');
  assert.equal(b.created_at, FIXED);
  assert.equal(b.closed_at, null);
  assert.equal(b.closed_reason, null);
  assert.equal(b.first_commit, null);
  assert.equal(b.trailer_present, false);
});

test('newBinding defaults its id to a fresh ULID when none is injected', () => {
  const b = newBinding(base(), { now: fixedClock });
  assert.match(b.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('newBinding preserves a provided first_commit and trailer_present:true', () => {
  const b = newBinding(base({ first_commit: 'deadbeef', trailer_present: true }), { now: fixedClock, id: BID });
  assert.equal(validateBinding(b).valid, true);
  assert.equal(b.first_commit, 'deadbeef');
  assert.equal(b.trailer_present, true);
});

test('newBinding coerces a non-true trailer_present to false', () => {
  const b = newBinding(base({ trailer_present: 'yes' }), { now: fixedClock, id: BID });
  assert.equal(b.trailer_present, false);
});

test('newBinding does not mutate its input fields', () => {
  const fields = base();
  newBinding(fields, { now: fixedClock, id: BID });
  assert.deepEqual(fields, base());
});

test('newBinding throws on a missing thread_id, repo or branch', () => {
  assert.throws(() => newBinding({ repo: 'r', branch: 'b' }, { now: fixedClock }), /thread_id/);
  assert.throws(() => newBinding({ thread_id: TID, branch: 'b' }, { now: fixedClock }), /repo/);
  assert.throws(() => newBinding({ thread_id: TID, repo: 'r' }, { now: fixedClock }), /branch/);
});
