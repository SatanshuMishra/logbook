import test from 'node:test';
import assert from 'node:assert/strict';
import rebuildIndexTool from '../../../src/tools/rebuild-index.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import transitionThread from '../../../src/tools/transition-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('rebuild_index returns counts including a resumable count', async (t) => {
  const ctx = await makeToolCtx(t);
  await openThread.handler(ctx, { title: 'One' });
  const { thread: two } = await openThread.handler(ctx, { title: 'Two' });
  await transitionThread.handler(ctx, { thread_id: two.id, to_status: 'paused' });
  const { counts } = await rebuildIndexTool.handler(ctx, {});
  assert.equal(counts.threads, 2);
  assert.equal(counts.resumable, 2);
});

test('rebuild_index does not commit (index is derived)', async (t) => {
  const ctx = await makeToolCtx(t);
  let commits = 0;
  ctx.driver.commit = async () => { commits += 1; return { committed: false }; };
  await rebuildIndexTool.handler(ctx, {});
  assert.equal(commits, 0);
});
