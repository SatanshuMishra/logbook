import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRoster } from '../../../hooks/lib/roster.mjs';

test('formatRoster renders a header and one bullet per thread', () => {
  const out = formatRoster([
    { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', slug: 'my-thread', title: 'My Thread', status: 'paused', next_step: 'do the thing' },
  ]);
  assert.match(out, /resumable threads \(1\)/);
  assert.match(out, /my-thread/);
  assert.match(out, /paused/);
  assert.match(out, /do the thing/);
  assert.match(out, /01ARZ3NDEKTSV4RRFFQ69G5FAV/);
});

test('formatRoster degrades to a stable line for an empty or missing roster', () => {
  const expected = 'Logbook: no resumable threads.';
  assert.equal(formatRoster([]), expected);
  assert.equal(formatRoster(null), expected);
  assert.equal(formatRoster(undefined), expected);
});

test('formatRoster tolerates entries missing optional fields', () => {
  const out = formatRoster([{ id: '01BX5ZZKBKACTAV9WEVGEMMVRZ', status: 'active' }]);
  assert.match(out, /01BX5ZZKBKACTAV9WEVGEMMVRZ/);
  assert.match(out, /active/);
});
