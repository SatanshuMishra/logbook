import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStop } from '../../../hooks/lib/stop.mjs';

function stubCtx(activeThreadResult) {
  const calls = [];
  return {
    calls,
    input: {},
    env: {},
    projectDir: '/proj',
    invokeCliJson: async (args) => {
      calls.push(args);
      return activeThreadResult;
    },
    invokeCli: async (args) => {
      calls.push(args);
      return { code: 0, stdout: '{}', stderr: '' };
    },
  };
}

test('Stop blocks with exit 2 while the active-thread pointer is non-empty', async () => {
  const ctx = stubCtx({ thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  const result = await handleStop(ctx);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /01ARZ3NDEKTSV4RRFFQ69G5FAV/);
  assert.deepEqual(ctx.calls, [['active-thread']]);
});

test('Stop passes and publishes via sync when the pointer is empty', async () => {
  const ctx = stubCtx({ thread_id: null });
  const result = await handleStop(ctx);
  assert.deepEqual(result, {});
  assert.deepEqual(ctx.calls, [['active-thread'], ['sync']]);
});

test('Stop passes (fail-open) when the active-thread read fails', async () => {
  const ctx = stubCtx(null);
  const result = await handleStop(ctx);
  assert.deepEqual(result, {});
  assert.deepEqual(ctx.calls, [['active-thread'], ['sync']]);
});
