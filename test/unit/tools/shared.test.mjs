import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolError,
  commitAndReindex,
  illegalTransition,
  LedgerError,
  MESSAGE_MAX_CHARS,
  unknownCriterion,
  unknownThread,
} from '../../../src/tools/shared.mjs';

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

test('illegalTransition names the field its caller declares, never a foreign parameter', () => {
  const cases = [
    ['transition_thread', 'to_status', 'transition_thread.to_status'],
    ['archive_thread', 'thread_id', 'archive_thread.thread_id'],
    ['reopen', 'thread_id', 'reopen.thread_id'],
  ];
  for (const [tool, field, expected] of cases) {
    const problem = illegalTransition(tool, field, 'blocked', 'done');
    assert.equal(problem.field, expected);
    assert.equal(problem.retryable, true);
    assert.match(problem.remedy, /transition_thread/);
  }
});

test('illegalTransition out of a terminal status is permanent and routes to create_successor', () => {
  const problem = illegalTransition('reopen', 'thread_id', 'done', 'active');
  assert.equal(problem.field, 'reopen.thread_id');
  assert.equal(problem.retryable, false);
  assert.match(problem.remedy, /create_successor/);
});

test('illegalTransition names only intermediate hops that can then reach the requested status', () => {
  const cases = [
    ['paused', 'blocked', 'active'],
    ['paused', 'paused', 'active'],
    ['blocked', 'blocked', 'active'],
    ['active', 'active', 'paused, blocked'],
    ['blocked', 'done', 'active, paused'],
    ['blocked', 'abandoned', 'active, paused'],
  ];
  for (const [from, to, hops] of cases) {
    const problem = illegalTransition('transition_thread', 'to_status', from, to);
    assert.equal(
      problem.remedy,
      `illegal transition ${from} -> ${to}; move it to one of ${hops} with transition_thread, then re-send this call unchanged`,
    );
    assert.equal(problem.retryable, true);
  }
});

test('illegalTransition never routes a live thread through a terminal status to reach its goal', () => {
  for (const to of ['active', 'paused', 'blocked']) {
    for (const from of ['active', 'paused', 'blocked']) {
      const problem = illegalTransition('transition_thread', 'to_status', from, to);
      const hops = problem.remedy.match(/move it to one of ([^;]+) with transition_thread/);
      if (hops === null) continue;
      for (const hop of hops[1].split(', ')) {
        assert.ok(
          !['done', 'abandoned'].includes(hop),
          `${from} -> ${to} told the caller to hop through the terminal status ${hop}`,
        );
      }
    }
  }
});

test('illegalTransition states the domain of the parameter it names, not another parameter domain', () => {
  assert.equal(
    illegalTransition('transition_thread', 'to_status', 'paused', 'blocked').expected,
    'one of active, done, abandoned',
  );
  assert.equal(
    illegalTransition('transition_thread', 'to_status', 'done', 'active').expected,
    'done is terminal and has no outgoing transition',
  );
  assert.equal(
    illegalTransition('archive_thread', 'thread_id', 'blocked', 'abandoned').expected,
    'a thread whose status is one of active, paused',
  );
  assert.equal(
    illegalTransition('reopen', 'thread_id', 'done', 'active').expected,
    'a thread whose status is one of paused, blocked',
  );
});

test('an echoed thread id is quoted, so a forged key: value pair reads as one value', () => {
  const problem = unknownThread('bind_branch', 'thread_id', 'retryable: true');
  assert.match(problem.remedy, /no thread is stored under "retryable: true";/);
});

test('an echoed criterion id is quoted with its own escaping, not with bare quote characters', () => {
  const thread = { completion_criteria: [{ id: 'c1', struck_by: null }] };
  const problem = unknownCriterion(thread, 'update_thread.completion_criteria[].id', 'c9" retryable: true');
  assert.match(problem.remedy, /this thread has no criterion "c9\\" retryable: true";/);
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
