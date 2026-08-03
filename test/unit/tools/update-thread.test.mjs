import test from 'node:test';
import assert from 'node:assert/strict';
import { newThread } from '../../../src/model/index.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import { callTool, ToolValidationError } from '../../../src/tools/registry.mjs';
import { makeToolCtx, fixedClock } from '../../fixtures/tool-ctx.mjs';

const DOD = [{ text: 'ship it' }];

test('update_thread patches spine fields and keeps spine.status synced to thread.status', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S', completion_criteria: DOD });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, spine: { active_goal: 'ship v2', next_step: 'write tests' },
  });
  assert.equal(updated.spine.active_goal, 'ship v2');
  assert.equal(updated.spine.next_step, 'write tests');
  assert.equal(updated.spine.status, 'active');
});

test('update_thread toggles completion_criteria done by id, leaving text and kind intact', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'S', completion_criteria: [{ text: 'a' }, { text: 'b' }],
  });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, completion_criteria: [{ id: 'c1', done: true }],
  });
  assert.deepEqual(updated.completion_criteria, [
    { id: 'c1', text: 'a', done: true, kind: 'planned', struck_by: null },
    { id: 'c2', text: 'b', done: false, kind: 'planned', struck_by: null },
  ]);
});

test('update_thread rejects an unknown completion_criteria id, naming it', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S', completion_criteria: [{ text: 'a' }] });
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: thread.id, completion_criteria: [{ id: 'c9', done: true }] }),
    /unknown completion_criteria id "c9"/,
  );
});

test('update_thread no longer accepts a text-matched completion_criteria patch', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S', completion_criteria: [{ text: 'a' }] });
  await assert.rejects(
    () => callTool('update_thread', {
      thread_id: thread.id, completion_criteria: [{ text: 'a', done: true }],
    }, ctx),
    ToolValidationError,
  );
});

test('update_thread refuses a terminal thread', async (t) => {
  const ctx = await makeToolCtx(t);
  const seed = newThread({ title: 'Done', completion_criteria: DOD }, { now: fixedClock });
  await ctx.driver.writeThread({ ...seed, status: 'abandoned', abandoned_reason: 'x', spine: { ...seed.spine, status: 'abandoned' } });
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: seed.id, spine: { active_goal: 'y' } }),
    /cannot mutate a terminal/,
  );
});

test('update_thread enforces spine caps', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S', completion_criteria: DOD });
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: thread.id, spine: { active_goal: 'a'.repeat(501) } }),
    /active_goal/,
  );
});
