import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import recordDecision from '../../../src/tools/record-decision.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

async function record(ctx, thread, over = {}) {
  return recordDecision.handler(ctx, {
    thread_id: thread.id,
    slug: 'adopt-x',
    title: 'Adopt X',
    context: 'we needed X',
    options: ['X', 'Y'],
    outcome: 'chose X',
    ...over,
  });
}

test('record_decision writes a numbered MADR file with Thread-Id frontmatter', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions', completion_criteria: [{ text: 'ship it' }] });
  const { number, path } = await record(ctx, thread);
  assert.equal(number, '0001');
  const md = await readFile(path, 'utf8');
  assert.match(md, new RegExp(`Thread-Id: ${thread.id}`));
  assert.match(md, /## Options/);
  assert.match(md, /- X/);
});

test('record_decision links a scoped decision object into the thread spine (dedup by ref)', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions', completion_criteria: [{ text: 'ship it' }] });
  await record(ctx, thread);
  const after = await ctx.driver.readThread(thread.id);
  assert.deepEqual(after.spine.key_decisions, [
    { ref: '0001-adopt-x', title: 'Adopt X', scope: 'c1' },
  ]);
  await record(ctx, after, { title: 'Adopt X again' });
  const after2 = await ctx.driver.readThread(thread.id);
  assert.deepEqual(after2.spine.key_decisions, [
    { ref: '0001-adopt-x', title: 'Adopt X', scope: 'c1' },
    { ref: '0002-adopt-x', title: 'Adopt X again', scope: 'c1' },
  ]);
});

test('record_decision scopes a decision to the current criterion, skipping the done ones', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'Decisions', completion_criteria: [{ text: 'first' }, { text: 'second' }],
  });
  await updateThread.handler(ctx, { thread_id: thread.id, completion_criteria: [{ id: 'c1', done: true }] });
  await record(ctx, thread);
  const after = await ctx.driver.readThread(thread.id);
  assert.equal(after.spine.key_decisions[0].scope, 'c2');
});

test('record_decision passes an explicit scope through', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions', completion_criteria: [{ text: 'ship it' }] });
  await record(ctx, thread, { scope: 'thread' });
  const after = await ctx.driver.readThread(thread.id);
  assert.equal(after.spine.key_decisions[0].scope, 'thread');
});

test('record_decision refuses the legacy scope', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions', completion_criteria: [{ text: 'ship it' }] });
  await assert.rejects(() => record(ctx, thread, { scope: 'legacy' }), /legacy/);
});

test('record_decision rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => recordDecision.handler(ctx, {
      thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', slug: 's', title: 't', context: 'c', options: ['a'], outcome: 'o',
    }),
    /thread_id .* does not reference an existing thread/,
  );
});
