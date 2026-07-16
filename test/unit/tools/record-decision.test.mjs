import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import recordDecision from '../../../src/tools/record-decision.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
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
  const { thread } = await openThread.handler(ctx, { title: 'Decisions' });
  const { number, path } = await record(ctx, thread);
  assert.equal(number, '0001');
  const md = await readFile(path, 'utf8');
  assert.match(md, new RegExp(`Thread-Id: ${thread.id}`));
  assert.match(md, /## Options/);
  assert.match(md, /- X/);
});

test('record_decision links NNNN-slug into the thread spine (dedup)', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions' });
  await record(ctx, thread);
  const after = await ctx.driver.readThread(thread.id);
  assert.deepEqual(after.spine.key_decisions, ['0001-adopt-x']);
  await record(ctx, after, { title: 'Adopt X again' });
  const after2 = await ctx.driver.readThread(thread.id);
  assert.deepEqual(after2.spine.key_decisions, ['0001-adopt-x', '0002-adopt-x']);
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
