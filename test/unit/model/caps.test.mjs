import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPINE_CAPS,
  COUNT_CAPPED_ARRAY_FIELDS,
  CapViolationError,
  assertSpineCaps,
} from '../../../src/model/caps.mjs';

function spine(overrides) {
  return {
    status: 'active',
    active_goal: 'g',
    next_step: 'n',
    open_risks: [],
    key_decisions: [],
    out_of_scope: [],
    ...overrides,
  };
}

test('SPINE_CAPS carries the exact pinned values and is frozen', () => {
  assert.deepEqual(SPINE_CAPS, { scalarFieldMaxChars: 500, arrayMaxItems: 20, arrayItemMaxChars: 300 });
  assert.ok(Object.isFrozen(SPINE_CAPS));
});

test('COUNT_CAPPED_ARRAY_FIELDS is exactly open_risks and out_of_scope', () => {
  assert.deepEqual([...COUNT_CAPPED_ARRAY_FIELDS], ['open_risks', 'out_of_scope']);
});

test('a within-caps spine is returned unchanged', () => {
  const s = spine({ open_risks: ['r1'], key_decisions: ['0001-x'], out_of_scope: ['later'] });
  assert.equal(assertSpineCaps(s), s);
});

test('a scalar field over the char cap throws CapViolationError with the field', () => {
  assert.throws(
    () => assertSpineCaps(spine({ active_goal: 'a'.repeat(501) })),
    (err) => {
      assert.ok(err instanceof CapViolationError);
      assert.equal(err.name, 'CapViolationError');
      assert.equal(err.field, 'active_goal');
      return true;
    },
  );
});

test('a scalar field exactly at the char cap passes', () => {
  const s = spine({ next_step: 'a'.repeat(500) });
  assert.equal(assertSpineCaps(s), s);
});

test('a count-capped array over the item cap throws', () => {
  const many = Array.from({ length: 21 }, (_, i) => `r${i}`);
  assert.throws(() => assertSpineCaps(spine({ open_risks: many })), /open_risks/);
  assert.throws(() => assertSpineCaps(spine({ out_of_scope: many })), /out_of_scope/);
});

test('a count-capped array exactly at the item cap passes', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `r${i}`);
  const s = spine({ open_risks: twenty });
  assert.equal(assertSpineCaps(s), s);
});

test('key_decisions is exempt from the item-count cap', () => {
  const twentyOne = Array.from({ length: 21 }, (_, i) => `${String(i).padStart(4, '0')}-d`);
  const s = spine({ key_decisions: twentyOne });
  assert.equal(assertSpineCaps(s), s);
});

test('any array item over the char cap throws for all three arrays', () => {
  const big = 'a'.repeat(301);
  assert.throws(() => assertSpineCaps(spine({ open_risks: [big] })), CapViolationError);
  assert.throws(() => assertSpineCaps(spine({ key_decisions: [big] })), CapViolationError);
  assert.throws(() => assertSpineCaps(spine({ out_of_scope: [big] })), CapViolationError);
});

test('a non-object spine throws CapViolationError', () => {
  assert.throws(() => assertSpineCaps(null), CapViolationError);
  assert.throws(() => assertSpineCaps('nope'), CapViolationError);
});
