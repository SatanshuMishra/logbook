import test from 'node:test';
import assert from 'node:assert/strict';
import { newThread } from '../../../src/model/index.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import { makeToolCtx, fixedClock } from '../../fixtures/tool-ctx.mjs';

test('update_thread patches spine fields and keeps spine.status synced to thread.status', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S' });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, spine: { active_goal: 'ship v2', next_step: 'write tests' },
  });
  assert.equal(updated.spine.active_goal, 'ship v2');
  assert.equal(updated.spine.next_step, 'write tests');
  assert.equal(updated.spine.status, 'active');
});

test('update_thread toggles completion_criteria done by immutable text match', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'S', completion_criteria: [{ text: 'a' }, { text: 'b' }],
  });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, completion_criteria: [{ text: 'a', done: true }],
  });
  assert.deepEqual(updated.completion_criteria, [{ text: 'a', done: true }, { text: 'b', done: false }]);
});

test('update_thread rejects an unknown completion_criteria text', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S', completion_criteria: [{ text: 'a' }] });
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: thread.id, completion_criteria: [{ text: 'ghost', done: true }] }),
    /unknown completion_criteria text/,
  );
});

test('update_thread refuses a terminal thread', async (t) => {
  const ctx = await makeToolCtx(t);
  const seed = newThread({ title: 'Done' }, { now: fixedClock });
  await ctx.driver.writeThread({ ...seed, status: 'abandoned', abandoned_reason: 'x', spine: { ...seed.spine, status: 'abandoned' } });
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: seed.id, spine: { active_goal: 'y' } }),
    /cannot mutate a terminal/,
  );
});

test('update_thread enforces spine caps', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S' });
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: thread.id, spine: { active_goal: 'a'.repeat(501) } }),
    /active_goal/,
  );
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: thread.id, spine: { open_risks: ['r'.repeat(301)] } }),
    /open_risks item exceeds 300 chars/,
  );
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id, spine: { out_of_scope: Array.from({ length: 21 }, (_, i) => `s${i}`) },
    }),
    /out_of_scope exceeds 20 items/,
  );
});

async function seedOverCapThread(ctx, overCapSpine) {
  const seed = newThread({ title: 'Wedged' }, { now: fixedClock });
  await ctx.driver.writeThread({ ...seed, spine: { ...seed.spine, ...overCapSpine } });
  return seed;
}

test('update_thread patches an untouched field on a thread whose stored spine is already over cap', async (t) => {
  const ctx = await makeToolCtx(t);
  const storedRisks = Array.from({ length: 25 }, (_, i) => `risk ${i}`);
  const seed = await seedOverCapThread(ctx, { open_risks: storedRisks, active_goal: 'a'.repeat(600) });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: seed.id, spine: { next_step: 'save the session' },
  });
  assert.equal(updated.spine.next_step, 'save the session');
  assert.deepEqual(updated.spine.open_risks, storedRisks);
  assert.equal(updated.spine.active_goal, 'a'.repeat(600));
});

test('update_thread still refuses over-cap content on a field whose stored value was already over cap', async (t) => {
  const ctx = await makeToolCtx(t);
  const seed = await seedOverCapThread(ctx, { open_risks: Array.from({ length: 25 }, (_, i) => `risk ${i}`) });
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: seed.id, spine: { open_risks: Array.from({ length: 21 }, (_, i) => `new ${i}`) },
    }),
    /open_risks exceeds 20 items/,
  );
});

test('update_thread reports every cap violation in the patch in one rejection', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'S' });
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id,
      spine: { active_goal: 'a'.repeat(501), next_step: 'b'.repeat(501), key_decisions: ['k'.repeat(301)] },
    }),
    (err) => {
      assert.match(err.message, /spine\.active_goal exceeds 500 chars/);
      assert.match(err.message, /spine\.next_step exceeds 500 chars/);
      assert.match(err.message, /spine\.key_decisions item exceeds 300 chars/);
      return true;
    },
  );
});
