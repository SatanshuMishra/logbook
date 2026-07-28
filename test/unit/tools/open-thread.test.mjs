import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import openThread from '../../../src/tools/open-thread.mjs';
import { readActiveThread } from '../../../src/util/active-thread.mjs';
import { makeToolCtx, FIXED } from '../../fixtures/tool-ctx.mjs';

test('open_thread declares the frozen name and an object inputSchema', () => {
  assert.equal(openThread.name, 'open_thread');
  assert.equal(openThread.inputSchema.type, 'object');
  assert.equal(openThread.inputSchema.additionalProperties, false);
});

test('open_thread creates an active thread, writes the pointer, and returns {thread}', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'My Thread' });
  assert.equal(thread.status, 'active');
  assert.equal(thread.slug, 'my-thread');
  assert.equal(thread.created_at, FIXED);
  assert.equal(await readActiveThread(ctx), thread.id);
  assert.deepEqual(await ctx.driver.readThread(thread.id), thread);
});

test('open_thread carries optional completion_criteria (done defaults false)', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'X', completion_criteria: [{ text: 'ship' }],
  });
  assert.deepEqual(thread.completion_criteria, [{ text: 'ship', done: false }]);
});

test('open_thread rejects an unknown parent_id (referential integrity)', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => openThread.handler(ctx, { title: 'X', parent_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
    /parent_id .* does not reference an existing thread/,
  );
});

test('open_thread links an EXISTING parent_id', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread: parent } = await openThread.handler(ctx, { title: 'Parent' });
  const { thread: child } = await openThread.handler(ctx, { title: 'Child', parent_id: parent.id });
  assert.equal(child.parent_id, parent.id);
});

test('open_thread reports recovery_degraded:false while the recovery repo is healthy', async (t) => {
  const ctx = await makeToolCtx(t);
  const result = await openThread.handler(ctx, { title: 'Healthy' });
  assert.equal(result.recovery_degraded, false);
});

test('open_thread reports recovery_degraded:true when the recovery repo is gone', async (t) => {
  const ctx = await makeToolCtx(t);
  await rm(join(await ctx.driver.root(), '.git'), { recursive: true, force: true });
  const result = await openThread.handler(ctx, { title: 'Degraded' });
  assert.equal(result.recovery_degraded, true);
  assert.equal(result.thread.status, 'active');
});
