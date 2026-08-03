import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDriftSnapshot } from '../../../src/drift/snapshot.mjs';

const THREAD_A = '0123456789ABCDEFGHJKMNPQRS';
const THREAD_B = '0123456789ABCDEFGHJKMNPQRT';

function entry(bindingId, threadId, overrides = {}) {
  return {
    binding_id: bindingId,
    thread_id: threadId,
    repo: 'acme/app',
    branch: 'feat/a1',
    classification: 'WARNING',
    signals: [],
    ...overrides,
  };
}

test('mergeDriftSnapshot replaces the prior entry of a re-observed binding in place', () => {
  const existing = {
    [THREAD_A]: [entry('01BA1', THREAD_A), entry('01BA2', THREAD_A, { branch: 'feat/a2' })],
  };

  const merged = mergeDriftSnapshot(existing, [entry('01BA1', THREAD_A, { classification: 'CRITICAL' })]);

  assert.deepEqual(merged[THREAD_A].map((e) => e.binding_id), ['01BA1', '01BA2']);
  assert.equal(merged[THREAD_A][0].classification, 'CRITICAL');
  assert.deepEqual(existing[THREAD_A].map((e) => e.classification), ['WARNING', 'WARNING']);
});

test('mergeDriftSnapshot appends entries for threads and bindings the prior snapshot never saw', () => {
  const merged = mergeDriftSnapshot(
    { [THREAD_A]: [entry('01BA1', THREAD_A)] },
    [entry('01BA2', THREAD_A, { branch: 'feat/a2' }), entry('01BB1', THREAD_B, { branch: 'feat/b1' })],
  );

  assert.deepEqual(merged[THREAD_A].map((e) => e.binding_id), ['01BA1', '01BA2']);
  assert.deepEqual(merged[THREAD_B].map((e) => e.binding_id), ['01BB1']);
});

test('mergeDriftSnapshot rejects a malformed prior snapshot instead of silently dropping it', () => {
  assert.throws(() => mergeDriftSnapshot([entry('01BA1', THREAD_A)], []), /object keyed by thread_id/);
  assert.throws(() => mergeDriftSnapshot({ [THREAD_A]: 'nope' }, []), /must be an array/);
  assert.throws(() => mergeDriftSnapshot({ [THREAD_A]: [{ branch: 'feat/a1' }] }, []), /thread_id/);
});

test('mergeDriftSnapshot treats an absent prior snapshot as empty', () => {
  assert.deepEqual(mergeDriftSnapshot(null, [entry('01BA1', THREAD_A)]), {
    [THREAD_A]: [entry('01BA1', THREAD_A)],
  });
});
