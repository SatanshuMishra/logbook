import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import archiveThread from '../../../src/tools/archive-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import bindBranch from '../../../src/tools/bind-branch.mjs';
import transitionThread from '../../../src/tools/transition-thread.mjs';
import { activeThreadPath, readActiveThread, writeActiveThread } from '../../../src/util/active-thread.mjs';
import { makeGitToolCtx, makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('archive_thread abandons an active thread and clears the pointer', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const { thread: archived } = await archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' });
  assert.equal(archived.status, 'abandoned');
  assert.equal(archived.abandoned_reason, 'obsolete');
  assert.equal('status' in archived.spine, false);
  assert.equal(await readActiveThread(ctx), null);
});

test('archive_thread releases a pointer naming the archived thread even when that thread is not active', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
  await bindBranch.handler(ctx, { thread_id: thread.id, repo: 'acme/app', branch: 'feat/x' });
  assert.equal(await readActiveThread(ctx), thread.id);
  const result = await archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' });
  assert.equal(result.thread.status, 'abandoned');
  assert.equal(await readActiveThread(ctx), null);
  assert.equal('warnings' in result, false);
});

test('archive_thread leaves a pointer naming a different thread untouched and silent', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread: a } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const { thread: b } = await openThread.handler(ctx, { title: 'B', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(await readActiveThread(ctx), b.id);
  const result = await archiveThread.handler(ctx, { thread_id: a.id, reason: 'obsolete' });
  assert.equal(result.thread.status, 'abandoned');
  assert.equal(await readActiveThread(ctx), b.id);
  assert.equal('warnings' in result, false);
});

test('archive_thread keeps closing threads when the pointer can be neither read nor replaced', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  await transitionThread.handler(ctx, { thread_id: thread.id, to_status: 'paused' });
  await bindBranch.handler(ctx, { thread_id: thread.id, repo: 'acme/app', branch: 'feat/x' });
  const pointer = await activeThreadPath(ctx);
  const holder = dirname(pointer);
  assert.equal(await readActiveThread(ctx), thread.id);
  await chmod(pointer, 0o000);
  await chmod(holder, 0o500);

  try {
    const result = await archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' });
    assert.equal(result.thread.status, 'abandoned');
    assert.equal((await ctx.driver.readThread(thread.id)).status, 'abandoned');
    const raised = (result.warnings ?? []).join('\n');
    assert.match(raised, /pointer not read/);
    assert.match(raised, /the pointer file is unusable \(EACCES\)/);
    assert.match(raised, /whether the end-of-session debrief gate is armed cannot be told from here/);

    const { thread: next } = await openThread.handler(ctx, { title: 'B', completion_criteria: [{ text: 'ship it' }] });
    const closed = await archiveThread.handler(ctx, { thread_id: next.id, reason: 'obsolete' });
    assert.equal(closed.thread.status, 'abandoned');
  } finally {
    await chmod(holder, 0o700);
    await chmod(pointer, 0o600);
  }

  assert.equal(await readActiveThread(ctx), thread.id);
});

test('archive_thread leaves a pointer another session moved on to a different thread', async (t) => {
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

  const result = await archiveThread.handler(ctx, { thread_id: a.id, reason: 'obsolete' });
  delete ctx.driver.writeThread;

  assert.equal(await readActiveThread(ctx), b.id);
  assert.equal(result.thread.status, 'abandoned');
  const raised = (result.warnings ?? []).join('\n');
  assert.match(raised, /pointer not cleared: it no longer names this thread/);
  assert.match(raised, new RegExp(`the pointer names ${b.id}, so the end-of-session debrief gate will fire for that thread`));
});

test('archive_thread refuses an unreadable pointer and leaves the thread record unchanged', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const pointer = await activeThreadPath(ctx);
  await chmod(pointer, 0o000);

  await assert.rejects(
    () => archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' }),
    (error) => {
      assert.equal(error.code, 'pointer_unreadable');
      assert.equal(error.layer, 'tool');
      assert.equal(error.retryable, true);
      assert.match(error.expected, /EACCES/);
      const emitted = error.toDetail().remedy;
      assert.equal(emitted, error.remedy, `the emitted remedy was clipped: ${emitted}`);
      assert.doesNotMatch(emitted, /\.\.\.$/);
      assert.equal(emitted.includes(pointer), false, `the remedy echoed a server path: ${emitted}`);
      assert.doesNotMatch(emitted, /\//);
      assert.match(emitted, /active-thread pointer file/);
      assert.match(emitted, /re-send this call unchanged/);
      return true;
    },
  );

  assert.equal((await ctx.driver.readThread(thread.id)).status, 'active');
  await chmod(pointer, 0o600);
  assert.equal(await readActiveThread(ctx), thread.id);
});

test('archive_thread reads a directory at the pointer path as no pointer, not an unreadable one', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  const pointer = await activeThreadPath(ctx);
  await rm(pointer, { force: true });
  await mkdir(pointer);

  const result = await archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' });
  assert.equal(result.thread.status, 'abandoned');
  assert.equal('warnings' in result, false);
  assert.equal((await ctx.driver.readThread(thread.id)).status, 'abandoned');
});

test('archive_thread leaves the pointer intact when the record write fails', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'A', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(await readActiveThread(ctx), thread.id);
  ctx.driver.writeThread = async () => {
    throw new Error('ENOSPC: no space left on device, write');
  };

  await assert.rejects(
    () => archiveThread.handler(ctx, { thread_id: thread.id, reason: 'obsolete' }),
    /ENOSPC/,
  );

  delete ctx.driver.writeThread;
  assert.equal(await readActiveThread(ctx), thread.id);
  assert.equal((await ctx.driver.readThread(thread.id)).status, 'active');
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
