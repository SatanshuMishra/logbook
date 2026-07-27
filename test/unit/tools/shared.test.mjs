import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolError, commitAndReindex } from '../../../src/tools/shared.mjs';

const HEALTHY_COMMIT = { committed: true, sha: 'abc', empty: false, degraded: false };
const DEGRADED_COMMIT = { committed: false, sha: null, empty: false, degraded: true };

function fakeDriver(commitResult = HEALTHY_COMMIT) {
  const calls = { commit: [], index: {} };
  return {
    async listThreads() { return []; },
    async listBindings() { return []; },
    async writeIndexFile(name, obj) { calls.index[name] = obj; },
    async commit(message) { calls.commit.push(message); return commitResult; },
    _calls: calls,
  };
}

test('ToolError carries its name', () => {
  const err = new ToolError('nope');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'ToolError');
  assert.equal(err.message, 'nope');
});

test('commitAndReindex rebuilds the index then commits, returning counts', async () => {
  const driver = fakeDriver();
  const { counts } = await commitAndReindex(driver, 'chore: x');
  assert.deepEqual(counts, {
    threads: 0, bindings: 0, by_slug: 0, by_branch: 0, children: 0, resumable: 0,
  });
  assert.deepEqual(driver._calls.commit, ['chore: x']);
  assert.deepEqual(Object.keys(driver._calls.index).sort(), ['by-branch', 'by-slug', 'children', 'resumable']);
});

test('commitAndReindex reindexes BEFORE it commits', async () => {
  const order = [];
  const driver = {
    async listThreads() { return []; },
    async listBindings() { return []; },
    async writeIndexFile() { order.push('index'); },
    async commit() { order.push('commit'); return HEALTHY_COMMIT; },
  };
  await commitAndReindex(driver, 'm');
  assert.equal(order[order.length - 1], 'commit');
  assert.ok(order.indexOf('index') < order.indexOf('commit'));
});

test('commitAndReindex reports recovery_degraded from the driver commit result', async () => {
  const healthy = await commitAndReindex(fakeDriver(), 'chore: x');
  assert.equal(healthy.recovery_degraded, false);
  const degraded = await commitAndReindex(fakeDriver(DEGRADED_COMMIT), 'chore: x');
  assert.equal(degraded.recovery_degraded, true);
});

test('commitAndReindex treats a driver commit result without the flag as healthy', async () => {
  const result = await commitAndReindex(fakeDriver({ committed: true }), 'chore: x');
  assert.equal(result.recovery_degraded, false);
});
