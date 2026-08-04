import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolError, commitAndReindex, LedgerError, MESSAGE_MAX_CHARS } from '../../../src/tools/shared.mjs';

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

test('ToolError is a LedgerError defaulting to the tool layer and populating every field', () => {
  const err = new ToolError({
    code: 'unknown_thread',
    field: 'reopen.thread_id',
    expected: 'a thread id this ledger holds',
    retryable: false,
    remedy: 'no thread is stored under that id; re-send with one the ledger returned',
  });
  assert.ok(err instanceof Error);
  assert.ok(err instanceof LedgerError);
  assert.equal(err.name, 'ToolError');
  assert.equal(err.layer, 'tool');
  assert.equal(err.code, 'unknown_thread');
  assert.equal(err.field, 'reopen.thread_id');
  assert.equal(err.retryable, false);
  assert.equal(err.message.split('\n')[0], 'unknown_thread: reopen.thread_id: a thread id this ledger holds');
  assert.equal(err.message.split('\n')[1], 'retryable: false');
});

test('a LedgerError refuses to exist without a layer, a remedy or a retryability verdict', () => {
  const complete = {
    code: 'unknown_thread',
    layer: 'tool',
    field: 'reopen.thread_id',
    expected: 'a thread id this ledger holds',
    retryable: false,
    remedy: 'send an id the ledger returned',
  };
  assert.doesNotThrow(() => new LedgerError(complete));
  for (const missing of ['code', 'layer', 'field', 'expected', 'retryable', 'remedy']) {
    const partial = { ...complete };
    delete partial[missing];
    assert.throws(() => new LedgerError(partial), TypeError, `omitting ${missing} should be rejected`);
  }
  assert.throws(() => new LedgerError({ ...complete, layer: 'made-up' }), TypeError);
  assert.throws(() => new LedgerError({ ...complete, retryable: 'false' }), TypeError);
});

test('a LedgerError message never exceeds the budget, however long its fields are', () => {
  const err = new LedgerError({
    code: 'cap_exceeded',
    layer: 'cap',
    field: 'f'.repeat(500),
    expected: 'e'.repeat(500),
    example: 'x'.repeat(500),
    retryable: true,
    remedy: 'r'.repeat(500),
  });
  assert.ok(err.message.length <= MESSAGE_MAX_CHARS, `measured ${err.message.length}`);
  assert.equal(err.message.split('\n')[1], 'retryable: true');
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
