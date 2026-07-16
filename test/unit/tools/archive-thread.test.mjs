import test from 'node:test';
import assert from 'node:assert/strict';
import archiveThread from '../../../src/tools/archive-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import transitionThread from '../../../src/tools/transition-thread.mjs';
import { readActiveThread } from '../../../src/util/active-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('archive_thread abandons an active thread and clears the pointer', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A' });
  const { thread: archived } = await archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' });
  assert.equal(archived.status, 'abandoned');
  assert.equal(archived.abandoned_reason, 'obsolete');
  assert.equal(archived.spine.status, 'abandoned');
  assert.equal(await readActiveThread(ctx), null);
});

test('archive_thread refuses a blocked thread (no blocked -> abandoned edge)', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A' });
  await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'blocked', blocked_by: 'CI' });
  await assert.rejects(
    () => archiveThread.handler(ctx, { thread_id: thread.id, reason: 'x' }),
    /illegal transition blocked -> abandoned/,
  );
});
