import test from 'node:test';
import assert from 'node:assert/strict';
import transitionThread from '../../../src/tools/transition-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import { readActiveThread } from '../../../src/util/active-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('transition_thread active->paused clears the pointer (identity-matched)', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  const { thread: paused } = await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
  assert.equal(paused.status, 'paused');
  assert.equal('status' in paused.spine, false);
  assert.equal(await readActiveThread(ctx), null);
});

test('transition_thread refuses an edge absent from the matrix', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'blocked', blocked_by: 'CI' });
  await assert.rejects(
    () => transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'abandoned', abandoned_reason: 'x' }),
    /illegal transition blocked -> abandoned/,
  );
});

test('transition_thread requires blocked_by for blocked and abandoned_reason for abandoned', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  await assert.rejects(() => transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'blocked' }), /blocked_by/);
  await assert.rejects(() => transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'abandoned' }), /abandoned_reason/);
});

test('transition_thread enforces the DoD gate for done', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'T', completion_criteria: [{ text: 'ship' }],
  });
  await assert.rejects(
    () => transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'done', closure_statement: 'shipped' }),
    /done/,
  );
});

test('transition_thread reaches done when criteria are all done and a closure_statement is given', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'T', completion_criteria: [{ text: 'ship' }],
  });
  await updateThread.handler(ctx, { thread_id: thread.id, completion_criteria: [{ id: 'c1', done: true }] });
  const { thread: done } = await transitionThread.handler(ctx, {
    thread_id: thread.id, to_status: 'done', closure_statement: 'shipped and verified',
  });
  assert.equal(done.status, 'done');
  assert.equal(done.closure_statement, 'shipped and verified');
  assert.equal(await readActiveThread(ctx), null);
});

test('transition_thread of a DIFFERENT thread leaves another thread pointer intact', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread: a } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const { thread: b } = await openThread.handler(ctx, { title: 'B', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(await readActiveThread(ctx), b.id);
  await transitionThread.handler(ctx, { thread_id: a.id, to_status: 'abandoned', abandoned_reason: 'drop A' });
  assert.equal(await readActiveThread(ctx), b.id);
});
