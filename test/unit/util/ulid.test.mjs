import test from 'node:test';
import assert from 'node:assert/strict';
import { newUlid, isUlid, ULID_PATTERN } from '../../../src/util/ulid.mjs';

test('newUlid returns a 26-char ULID matching the pattern', () => {
  const id = newUlid();
  assert.equal(typeof id, 'string');
  assert.equal(id.length, 26);
  assert.match(id, ULID_PATTERN);
  assert.ok(isUlid(id));
});

test('newUlid returns distinct values', () => {
  assert.notEqual(newUlid(), newUlid());
});

test('isUlid accepts a valid ULID', () => {
  assert.ok(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV'));
});

test('isUlid rejects wrong length', () => {
  assert.equal(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FA'), false);
  assert.equal(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVV'), false);
});

test('isUlid rejects excluded letters I/L/O/U', () => {
  assert.equal(isUlid('0000000000000000000000000I'), false);
  assert.equal(isUlid('0000000000000000000000000L'), false);
  assert.equal(isUlid('0000000000000000000000000O'), false);
  assert.equal(isUlid('0000000000000000000000000U'), false);
});

test('isUlid rejects lowercase', () => {
  assert.equal(isUlid('01arz3ndektsv4rrffq69g5fav'), false);
});

test('isUlid rejects non-strings without throwing', () => {
  assert.equal(isUlid(undefined), false);
  assert.equal(isUlid(null), false);
  assert.equal(isUlid(12345678901234567890123456), false);
  assert.equal(isUlid({}), false);
});
