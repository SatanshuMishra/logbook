import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import bindBranch from '../../../src/tools/bind-branch.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import { activeThreadPath, readActiveThread } from '../../../src/util/active-thread.mjs';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { clearedGitLocationEnv } from '../../../src/util/git-env.mjs';
import { makeToolCtx, makeGitToolCtx } from '../../fixtures/tool-ctx.mjs';

async function withUnwritablePointerDir(ctx, run) {
  const pointerDir = dirname(await activeThreadPath(ctx));
  await chmod(pointerDir, 0o500);
  try {
    return await run();
  } finally {
    await chmod(pointerDir, 0o700);
  }
}

async function ledgerRefHolds(ctx, path) {
  const { code } = await gitExec(
    ctx.projectDir,
    ['cat-file', '-e', `${ctx.driver.ledgerRef}:${path}`],
    { env: clearedGitLocationEnv(), check: false },
  );
  return code === 0;
}

test('bind_branch writes a binding for an existing thread and sets the pointer', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Work', completion_criteria: [{ text: 'ship it' }] });
  const { binding } = await bindBranch.handler(ctx, { thread_id: thread.id, repo: 'acme/app', branch: 'feat/x' });
  assert.equal(binding.thread_id, thread.id);
  assert.equal(binding.repo, 'acme/app');
  assert.equal(binding.branch, 'feat/x');
  assert.equal(binding.status, 'active');
  assert.equal(binding.trailer_present, false);
  assert.deepEqual(await ctx.driver.readBinding(binding.id), binding);
  assert.equal(await readActiveThread(ctx), thread.id);
});

test('bind_branch preserves first_commit and trailer_present', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Work', completion_criteria: [{ text: 'ship it' }] });
  const { binding } = await bindBranch.handler(ctx, {
    thread_id: thread.id, repo: 'acme/app', branch: 'feat/y', first_commit: 'deadbeef', trailer_present: true,
  });
  assert.equal(binding.first_commit, 'deadbeef');
  assert.equal(binding.trailer_present, true);
});

test('bind_branch commits and indexes the binding when the pointer write fails', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread: bound } = await openThread.handler(ctx, { title: 'Bound', completion_criteria: [{ text: 'ship it' }] });
  const { thread: later } = await openThread.handler(ctx, { title: 'Later', completion_criteria: [{ text: 'ship it' }] });

  const result = await withUnwritablePointerDir(ctx, () => bindBranch.handler(ctx, {
    thread_id: bound.id, repo: 'acme/app', branch: 'feat/x',
  }));

  assert.equal(result.binding.thread_id, bound.id);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /active-thread pointer not written/);
  assert.match(result.warnings[0], /the filesystem call failed \(EACCES\)/);
  assert.match(result.warnings[0], new RegExp(`the pointer names ${later.id}, so the end-of-session debrief gate will fire for that thread`));
  assert.doesNotMatch(result.warnings[0], new RegExp(bound.id));
  assert.deepEqual(await ctx.driver.readBinding(result.binding.id), result.binding);
  assert.deepEqual(
    (await ctx.driver.readIndexFile('by-branch'))['acme/app feat/x'],
    [result.binding.id],
  );
  assert.equal(await ledgerRefHolds(ctx, `bindings/${result.binding.id}.json`), true);
  assert.equal(await readActiveThread(ctx), later.id);
});

test('bind_branch rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => bindBranch.handler(ctx, { thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', repo: 'r', branch: 'b' }),
    /unknown_thread: bind_branch\.thread_id/,
  );
});
