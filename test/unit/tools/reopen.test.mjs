import test from 'node:test';
import assert from 'node:assert/strict';
import reopen from '../../../src/tools/reopen.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import transitionThread from '../../../src/tools/transition-thread.mjs';
import archiveThread from '../../../src/tools/archive-thread.mjs';
import { readActiveThread } from '../../../src/util/active-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('reopen moves a paused thread back to active and writes the pointer', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'R', completion_criteria: [{ text: 'ship it' }] });
  await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
  const { thread: reopened } = await reopen.handler(ctx, { thread_id: thread.id });
  assert.equal(reopened.status, 'active');
  assert.equal(reopened.spine.status, 'active');
  assert.equal(await readActiveThread(ctx), thread.id);
});

test('reopen moves a blocked thread back to active and clears blocked_by', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'R', completion_criteria: [{ text: 'ship it' }] });
  await transitionThread.handler(ctx, {
    thread_id: thread.id,
    to_status: 'blocked',
    blocked_by: 'waiting on upstream',
  });
  const { thread: reopened } = await reopen.handler(ctx, { thread_id: thread.id });
  assert.equal(reopened.status, 'active');
  assert.equal(reopened.spine.status, 'active');
  assert.equal(reopened.blocked_by, null);
  assert.equal(await readActiveThread(ctx), thread.id);
});

test('reopen refuses an already-active thread', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'R', completion_criteria: [{ text: 'ship it' }] });
  await assert.rejects(() => reopen.handler(ctx, { thread_id: thread.id }), /already active/);
});

test('reopen refuses a terminal thread and points to create_successor', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'R', completion_criteria: [{ text: 'ship it' }] });
  await archiveThread.handler(ctx, { thread_id: thread.id, reason: 'x' });
  await assert.rejects(() => reopen.handler(ctx, { thread_id: thread.id }), /create_successor/);
});
