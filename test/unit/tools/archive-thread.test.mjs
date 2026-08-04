import test from 'node:test';
import assert from 'node:assert/strict';
import archiveThread from '../../../src/tools/archive-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import transitionThread from '../../../src/tools/transition-thread.mjs';
import { readActiveThread, activeThreadPath } from '../../../src/util/active-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';
import { mkdir, rm } from 'node:fs/promises';

test('archive_thread abandons nothing when the pointer cannot be read', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const pointer = await activeThreadPath(ctx);
  await rm(pointer, { force: true });
  await mkdir(pointer, { recursive: true });
  await assert.rejects(() => archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' }));
  assert.equal((await ctx.driver.readThread(thread.id)).status, 'active');
});

test('archive_thread abandons an active thread and clears the pointer', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const { thread: archived } = await archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' });
  assert.equal(archived.status, 'abandoned');
  assert.equal(archived.abandoned_reason, 'obsolete');
  assert.equal('status' in archived.spine, false);
  assert.equal(await readActiveThread(ctx), null);
});

test('archive_thread refuses a blocked thread (no blocked -> abandoned edge)', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'blocked', blocked_by: 'CI' });
  await assert.rejects(
    () => archiveThread.handler(ctx, { thread_id: thread.id, reason: 'x' }),
    /illegal transition blocked -> abandoned/,
  );
});
