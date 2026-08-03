import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRoster } from '../../../hooks/lib/roster.mjs';

test('formatRoster renders a header and one progress-bearing bullet per thread', () => {
  const out = formatRoster([
    {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      slug: 'my-thread',
      title: 'My Thread',
      status: 'paused',
      next_step: 'do the thing',
      done: 3,
      total: 5,
      detours_open: 0,
    },
  ]);
  assert.match(out, /resumable threads \(1\)/);
  assert.equal(
    out.split('\n')[1],
    '- [paused] my-thread (3 of 5): My Thread -- next: do the thing (id 01ARZ3NDEKTSV4RRFFQ69G5FAV)',
  );
});

test('formatRoster truncates a long next step to 120 characters', () => {
  const out = formatRoster([
    { id: '01BX5ZZKBKACTAV9WEVGEMMVRZ', slug: 's', title: 'T', status: 'active', next_step: 'x'.repeat(400), done: 0, total: 1 },
  ]);
  const rendered = out.split('-- next: ')[1].split(' (id ')[0];
  assert.equal(rendered.length, 120);
  assert.equal(rendered, `${'x'.repeat(117)}...`);
});

test('formatRoster keeps a next step of exactly 120 characters intact', () => {
  const nextStep = 'y'.repeat(120);
  const out = formatRoster([
    { id: '01BX5ZZKBKACTAV9WEVGEMMVRZ', slug: 's', title: 'T', status: 'active', next_step: nextStep, done: 1, total: 1 },
  ]);
  const rendered = out.split('-- next: ')[1].split(' (id ')[0];
  assert.equal(rendered, nextStep);
});

test('formatRoster omits the progress fragment when the entry carries no counts', () => {
  const out = formatRoster([
    { id: '01BX5ZZKBKACTAV9WEVGEMMVRZ', slug: 'legacy', title: 'Legacy', status: 'active', next_step: 'go' },
  ]);
  assert.equal(out.split('\n')[1], '- [active] legacy: Legacy -- next: go (id 01BX5ZZKBKACTAV9WEVGEMMVRZ)');
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
