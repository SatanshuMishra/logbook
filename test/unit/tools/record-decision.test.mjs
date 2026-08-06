import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import recordDecision from '../../../src/tools/record-decision.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import { callTool } from '../../../src/tools/registry.mjs';
import { newThread } from '../../../src/model/index.mjs';
import { makeToolCtx, fixedClock } from '../../fixtures/tool-ctx.mjs';

function decisionArgs(thread, over = {}) {
  return {
    thread_id: thread.id,
    slug: 'adopt-x',
    title: 'Adopt X',
    context: 'we needed X',
    options: ['X', 'Y'],
    outcome: 'chose X',
    ...over,
  };
}

async function record(ctx, thread, over = {}) {
  return recordDecision.handler(ctx, decisionArgs(thread, over));
}

function withoutNumber(markdown, number) {
  return markdown.replace(`# ${number}. `, '# NNNN. ');
}

const UNVALIDATABLE_SPINE = { out_of_scope: [''] };

async function storeUnvalidatableThread(ctx, thread) {
  const root = await ctx.driver.root();
  const corrupted = { ...thread, spine: { ...thread.spine, ...UNVALIDATABLE_SPINE } };
  await writeFile(
    join(root, 'threads', `${thread.id}.json`),
    `${JSON.stringify(corrupted, null, 2)}\n`,
  );
  return root;
}

async function storeLegacyThread(ctx, spinePatch) {
  const seed = newThread({ title: 'Legacy', completion_criteria: [{ text: 'ship it' }] }, { now: fixedClock });
  await ctx.driver.writeThread({ ...seed, spine: { ...seed.spine, ...spinePatch } });
  return seed;
}

async function openWithUnvalidatableRecord(ctx) {
  const { thread } = await openThread.handler(ctx, {
    title: 'Decisions', completion_criteria: [{ text: 'ship it' }],
  });
  return { thread, root: await storeUnvalidatableThread(ctx, thread) };
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

test('record_decision accepts options as a bulleted string and renders it identically to the array form', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions', completion_criteria: [{ text: 'ship it' }] });
  const fromArray = await callTool('record_decision', decisionArgs(thread, { options: ['X', 'Y', 'Z'] }), ctx);
  const fromString = await callTool('record_decision', decisionArgs(thread, { options: '  - X \n\n* Y\nZ\n  ' }), ctx);
  const arrayMd = await readFile(fromArray.path, 'utf8');
  const stringMd = await readFile(fromString.path, 'utf8');
  assert.match(arrayMd, /## Options\n\n- X\n- Y\n- Z\n/);
  assert.equal(withoutNumber(stringMd, fromString.number), withoutNumber(arrayMd, fromArray.number));
});

test('record_decision rejects an options string that carries no options and writes nothing', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions', completion_criteria: [{ text: 'ship it' }] });
  await assert.rejects(
    () => callTool('record_decision', decisionArgs(thread, { options: '\n  \n' }), ctx),
    /empty_options: record_decision\.options/,
  );
  assert.equal(await ctx.driver.nextDecisionNumber(), '0001');
});

test('record_decision still rejects omitted options', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Decisions', completion_criteria: [{ text: 'ship it' }] });
  const { options, ...withoutOptions } = decisionArgs(thread);
  await assert.rejects(
    () => callTool('record_decision', withoutOptions, ctx),
    /missing_parameter: record_decision\.options/,
  );
});

test('record_decision leaves decisions/ empty and the number unconsumed when the record fails validation', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread, root } = await openWithUnvalidatableRecord(ctx);
  await assert.rejects(
    () => callTool('record_decision', decisionArgs(thread), ctx),
    /invalid_length: Thread\.spine\.out_of_scope\[0\]/,
  );
  assert.deepEqual(await readdir(join(root, 'decisions')), []);
  assert.equal(await ctx.driver.nextDecisionNumber(), '0001');
});

test('a record_decision whose decision write fails carries no spine ref and consumes no number', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'Decisions', completion_criteria: [{ text: 'ship it' }],
  });
  const { thread: sibling } = await openThread.handler(ctx, {
    title: 'Sibling', completion_criteria: [{ text: 'ship it too' }],
  });
  await assert.rejects(
    () => callTool('record_decision', decisionArgs(thread, { slug: 'a'.repeat(300) }), ctx),
    (err) => {
      assert.equal(err.code, 'ENAMETOOLONG');
      assert.match(err.path, /\/decisions\/0001-a+\.md/);
      return true;
    },
  );
  const after = await ctx.driver.readThread(thread.id);
  assert.deepEqual(after.spine.key_decisions, []);
  const { number } = await record(ctx, sibling);
  assert.equal(number, '0001');
});

test('a stored over-cap decision title never blocks a record_decision that submits a short one', async (t) => {
  const ctx = await makeToolCtx(t);
  const legacyTitle = 'a'.repeat(121);
  const seed = await storeLegacyThread(ctx, {
    key_decisions: [{ ref: '0009-legacy-ruling', title: legacyTitle, scope: 'thread' }],
  });
  const { number, path } = await record(ctx, seed);
  assert.equal(number, '0001');
  assert.match(path, /0001-adopt-x\.md$/);
  const after = await ctx.driver.readThread(seed.id);
  assert.deepEqual(after.spine.key_decisions, [
    { ref: '0009-legacy-ruling', title: legacyTitle, scope: 'thread' },
    { ref: '0001-adopt-x', title: 'Adopt X', scope: 'c1' },
  ]);
});

test('a stored over-cap active_goal never blocks a record_decision that cannot even submit it', async (t) => {
  const ctx = await makeToolCtx(t);
  const legacyGoal = 'a'.repeat(231);
  const seed = await storeLegacyThread(ctx, { active_goal: legacyGoal });
  const { number, path } = await record(ctx, seed);
  assert.equal(number, '0001');
  assert.match(path, /0001-adopt-x\.md$/);
  const after = await ctx.driver.readThread(seed.id);
  assert.equal(after.spine.active_goal, legacyGoal);
  assert.deepEqual(after.spine.key_decisions, [
    { ref: '0001-adopt-x', title: 'Adopt X', scope: 'c1' },
  ]);
});

test('record_decision refuses an over-cap title this call submits, writing nothing', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'Decisions', completion_criteria: [{ text: 'ship it' }],
  });
  const root = await ctx.driver.root();
  await assert.rejects(
    () => callTool('record_decision', decisionArgs(thread, { title: 'a'.repeat(121) }), ctx),
    /cap_exceeded: spine\.key_decisions\[\]\.title/,
  );
  assert.deepEqual(await readdir(join(root, 'decisions')), []);
  assert.equal(await ctx.driver.nextDecisionNumber(), '0001');
});

test('the dedup path never refuses an over-cap title it would not store', async (t) => {
  const ctx = await makeToolCtx(t);
  const stored = { ref: '0001-adopt-x', title: 'Adopt X', scope: 'thread' };
  const seed = await storeLegacyThread(ctx, { key_decisions: [stored] });
  const { number } = await record(ctx, seed, { title: 'a'.repeat(121) });
  assert.equal(number, '0001');
  const after = await ctx.driver.readThread(seed.id);
  assert.deepEqual(after.spine.key_decisions, [stored]);
});

test('record_decision rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => recordDecision.handler(ctx, {
      thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', slug: 's', title: 't', context: 'c', options: ['a'], outcome: 'o',
    }),
    /unknown_thread: record_decision\.thread_id/,
  );
});
