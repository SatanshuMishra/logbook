import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import transitionThread from '../../../src/tools/transition-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import bindBranch from '../../../src/tools/bind-branch.mjs';
import { activeThreadPath, readActiveThread, writeActiveThread } from '../../../src/util/active-thread.mjs';
import { makeGitToolCtx, makeToolCtx } from '../../fixtures/tool-ctx.mjs';

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

test('transition_thread releases a pointer naming the thread even when that thread is not active', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
  await bindBranch.handler(ctx, { thread_id: thread.id, repo: 'acme/app', branch: 'feat/x' });
  assert.equal(await readActiveThread(ctx), thread.id);
  const result = await transitionThread.handler(ctx, {
    thread_id: thread.id, to_status: 'abandoned', abandoned_reason: 'drop it',
  });
  assert.equal(result.thread.status, 'abandoned');
  assert.equal(await readActiveThread(ctx), null);
  assert.equal('warnings' in result, false);
});

test('transition_thread claims no pointer file it could not observe', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  const pointer = await activeThreadPath(ctx);
  const vault = join(ctx.projectDir, 'vault');
  await mkdir(vault);
  await writeFile(join(vault, 'active-thread'), `${thread.id}\n`);
  await rm(pointer, { force: true });
  await symlink(join(vault, 'active-thread'), pointer);
  await chmod(vault, 0o000);

  try {
    const result = await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
    const raised = (result.warnings ?? []).join('\n');
    assert.match(raised, /pointer not read/);
    assert.doesNotMatch(raised, /pointer file/, `the warning asserted a pointer file: ${raised}`);
    assert.doesNotMatch(raised, /exists/, `the warning asserted a pointer file: ${raised}`);
    assert.doesNotMatch(raised, /\//, `the warning echoed a server path: ${raised}`);
    assert.equal((await ctx.driver.readThread(thread.id)).status, 'paused');
  } finally {
    await chmod(vault, 0o700);
  }
});

test('transition_thread leaves a pointer another session moved on to a different thread', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread: b } = await openThread.handler(ctx, { title: 'B', completion_criteria: [{ text: 'ship it' }] });
  const { thread: a } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(await readActiveThread(ctx), a.id);
  const storeThread = ctx.driver.writeThread.bind(ctx.driver);
  ctx.driver.writeThread = async (record) => {
    const stored = await storeThread(record);
    await writeActiveThread(ctx, b.id);
    return stored;
  };

  const result = await transitionThread.handler(ctx, { thread_id: a.id, to_status: 'paused' });
  delete ctx.driver.writeThread;

  assert.equal(await readActiveThread(ctx), b.id);
  assert.equal(result.thread.status, 'paused');
  const raised = (result.warnings ?? []).join('\n');
  assert.match(raised, /pointer not cleared: it no longer names this thread/);
  assert.match(raised, new RegExp(`the pointer names ${b.id}, so the end-of-session debrief gate will fire for that thread`));
});

test('transition_thread stores the transition and reports a pointer it could not read', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  const pointer = await activeThreadPath(ctx);
  await chmod(pointer, 0o000);

  try {
    const result = await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
    assert.equal(result.thread.status, 'paused');
    assert.equal((await ctx.driver.readThread(thread.id)).status, 'paused');
    const raised = (result.warnings ?? []).join('\n');
    assert.match(raised, /pointer not read/);
    assert.match(raised, /the filesystem call failed \(EACCES\)/);
    assert.match(raised, /whether the end-of-session debrief gate is armed cannot be told from here/);
    assert.match(raised, /no pointer was released, so whatever it holds survives this call/);
  } finally {
    await chmod(pointer, 0o600);
  }

  assert.equal(await readActiveThread(ctx), thread.id);
});

test('transition_thread reads a pointer path blocked by a file as no pointer, not an unreadable one', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  const pointerDir = dirname(await activeThreadPath(ctx));
  await rm(pointerDir, { recursive: true, force: true });
  await writeFile(pointerDir, 'occupied\n');

  const result = await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
  assert.equal(result.thread.status, 'paused');
  assert.equal('warnings' in result, false);
  assert.equal((await ctx.driver.readThread(thread.id)).status, 'paused');
});

test('transition_thread leaves the pointer intact when the record write fails', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'T', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(await readActiveThread(ctx), thread.id);
  ctx.driver.writeThread = async () => {
    throw new Error('ENOSPC: no space left on device, write');
  };

  await assert.rejects(
    () => transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' }),
    /ENOSPC/,
  );

  delete ctx.driver.writeThread;
  assert.equal(await readActiveThread(ctx), thread.id);
  assert.equal((await ctx.driver.readThread(thread.id)).status, 'active');
});

test('transition_thread of a DIFFERENT thread leaves another thread pointer intact', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread: a } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const { thread: b } = await openThread.handler(ctx, { title: 'B', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(await readActiveThread(ctx), b.id);
  await transitionThread.handler(ctx, { thread_id: a.id, to_status: 'abandoned', abandoned_reason: 'drop A' });
  assert.equal(await readActiveThread(ctx), b.id);
});
