import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildIndex } from '../../../src/index/rebuild-index.mjs';

function fakeDriver(threads, bindings) {
  const written = {};
  return {
    written,
    async listThreads() { return threads; },
    async listBindings() { return bindings; },
    async writeIndexFile(name, obj) { written[name] = obj; },
  };
}

function thread(overrides) {
  return {
    id: 'T', slug: 's', title: 't', status: 'active',
    parent_id: null, created_at: '2026-01-01T00:00:00Z',
    spine: { next_step: 'step' },
    ...overrides,
  };
}

test('by-slug keeps the earliest-created thread on a slug collision', async () => {
  const early = thread({ id: '01AAAAAAAAAAAAAAAAAAAAAAAA', slug: 'dup', created_at: '2026-01-01T00:00:00Z' });
  const late = thread({ id: '01BBBBBBBBBBBBBBBBBBBBBBBB', slug: 'dup', created_at: '2026-06-01T00:00:00Z' });
  const driver = fakeDriver([late, early], []);
  await rebuildIndex(driver);
  assert.equal(driver.written['by-slug'].dup, '01AAAAAAAAAAAAAAAAAAAAAAAA');
});

test('by-branch groups binding ids per repo+branch key', async () => {
  const bindings = [
    { id: '01B1', repo: 'r', branch: 'feat/x', created_at: '2026-01-01T00:00:00Z' },
    { id: '01B2', repo: 'r', branch: 'feat/x', created_at: '2026-02-01T00:00:00Z' },
    { id: '01B3', repo: 'r', branch: 'feat/y', created_at: '2026-03-01T00:00:00Z' },
  ];
  const driver = fakeDriver([], bindings);
  await rebuildIndex(driver);
  assert.deepEqual(driver.written['by-branch'], {
    'r feat/x': ['01B1', '01B2'],
    'r feat/y': ['01B3'],
  });
});

test('children maps parent id to its child ids', async () => {
  const parent = thread({ id: '01P', slug: 'p', parent_id: null, created_at: '2026-01-01T00:00:00Z' });
  const c1 = thread({ id: '01C1', slug: 'c1', parent_id: '01P', created_at: '2026-01-02T00:00:00Z' });
  const c2 = thread({ id: '01C2', slug: 'c2', parent_id: '01P', created_at: '2026-01-03T00:00:00Z' });
  const driver = fakeDriver([c2, parent, c1], []);
  await rebuildIndex(driver);
  assert.deepEqual(driver.written['children'], { '01P': ['01C1', '01C2'] });
});

test('resumable includes only active/paused/blocked threads with spine next_step', async () => {
  const threads = [
    thread({ id: '01A', slug: 'a', status: 'active', spine: { next_step: 'do-a' }, created_at: '2026-01-01T00:00:00Z' }),
    thread({ id: '01P', slug: 'p', status: 'paused', spine: { next_step: 'do-p' }, created_at: '2026-01-02T00:00:00Z' }),
    thread({ id: '01B', slug: 'b', status: 'blocked', spine: { next_step: 'do-b' }, created_at: '2026-01-03T00:00:00Z' }),
    thread({ id: '01D', slug: 'd', status: 'done', spine: { next_step: 'x' }, created_at: '2026-01-04T00:00:00Z' }),
    thread({ id: '01X', slug: 'x', status: 'abandoned', spine: { next_step: 'x' }, created_at: '2026-01-05T00:00:00Z' }),
  ];
  const driver = fakeDriver(threads, []);
  const counts = await rebuildIndex(driver);
  assert.deepEqual(driver.written['resumable'], [
    { id: '01A', slug: 'a', title: 't', status: 'active', next_step: 'do-a' },
    { id: '01P', slug: 'p', title: 't', status: 'paused', next_step: 'do-p' },
    { id: '01B', slug: 'b', title: 't', status: 'blocked', next_step: 'do-b' },
  ]);
  assert.equal(counts.resumable, 3);
});

test('rebuildIndex returns integer counts for every index', async () => {
  const parent = thread({ id: '01P', slug: 'p', parent_id: null, created_at: '2026-01-01T00:00:00Z' });
  const child = thread({ id: '01C', slug: 'c', parent_id: '01P', created_at: '2026-01-02T00:00:00Z' });
  const driver = fakeDriver([parent, child], [
    { id: '01B', repo: 'r', branch: 'main', created_at: '2026-01-01T00:00:00Z' },
  ]);
  const counts = await rebuildIndex(driver);
  assert.deepEqual(counts, {
    threads: 2, bindings: 1, by_slug: 2, by_branch: 1, children: 1, resumable: 2,
  });
});

test('rebuildIndex on an empty driver writes empty indexes', async () => {
  const driver = fakeDriver([], []);
  const counts = await rebuildIndex(driver);
  assert.deepEqual(driver.written['by-slug'], {});
  assert.deepEqual(driver.written['by-branch'], {});
  assert.deepEqual(driver.written['children'], {});
  assert.deepEqual(driver.written['resumable'], []);
  assert.deepEqual(counts, {
    threads: 0, bindings: 0, by_slug: 0, by_branch: 0, children: 0, resumable: 0,
  });
});

test('rebuildIndex throws on a driver missing required methods', async () => {
  await assert.rejects(() => rebuildIndex({}), /listThreads/);
});
