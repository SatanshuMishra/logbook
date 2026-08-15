import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
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

async function addOrigin(ctx, url) {
  await gitExec(ctx.projectDir, ['remote', 'add', 'origin', url], { env: clearedGitLocationEnv() });
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
  const repo = basename(ctx.projectDir);
  const { thread: bound } = await openThread.handler(ctx, { title: 'Bound', completion_criteria: [{ text: 'ship it' }] });
  const { thread: later } = await openThread.handler(ctx, { title: 'Later', completion_criteria: [{ text: 'ship it' }] });

  const result = await withUnwritablePointerDir(ctx, () => bindBranch.handler(ctx, {
    thread_id: bound.id, repo, branch: 'feat/x',
  }));

  assert.equal(result.binding.thread_id, bound.id);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /active-thread pointer not written/);
  assert.match(result.warnings[0], /the filesystem call failed \(EACCES\)/);
  assert.match(result.warnings[0], new RegExp(`the pointer names ${later.id}, so the end-of-session debrief gate will fire for that thread`));
  assert.doesNotMatch(result.warnings[0], new RegExp(bound.id));
  assert.deepEqual(await ctx.driver.readBinding(result.binding.id), result.binding);
  assert.deepEqual(
    (await ctx.driver.readIndexFile('by-branch'))[`${repo} feat/x`],
    [result.binding.id],
  );
  assert.equal(await ledgerRefHolds(ctx, `bindings/${result.binding.id}.json`), true);
  assert.equal(await readActiveThread(ctx), later.id);
});

test('bind_branch refuses a repo naming a repository this ledger cannot observe', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Work', completion_criteria: [{ text: 'ship it' }] });

  const error = await bindBranch
    .handler(ctx, { thread_id: thread.id, repo: 'acme/app', branch: 'feat/x' })
    .then(() => null, (raised) => raised);

  assert.equal(error.code, 'invalid_value');
  assert.equal(error.field, 'bind_branch.repo');
  assert.equal(error.layer, 'tool');
  assert.match(error.expected, new RegExp(basename(ctx.projectDir)));
  assert.match(error.remedy, new RegExp(`re-send with ${basename(ctx.projectDir)}`));
  assert.deepEqual(await ctx.driver.listBindings(), []);
});

test('bind_branch accepts the work-tree directory name of the repository it observes', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Work', completion_criteria: [{ text: 'ship it' }] });
  const { binding } = await bindBranch.handler(ctx, {
    thread_id: thread.id, repo: basename(ctx.projectDir), branch: 'feat/x',
  });
  assert.equal(binding.repo, basename(ctx.projectDir));
});

test('bind_branch accepts the origin owner/name of the repository it observes', async (t) => {
  const ctx = await makeGitToolCtx(t);
  await addOrigin(ctx, 'git@github.com:acme/app.git');
  const { thread } = await openThread.handler(ctx, { title: 'Work', completion_criteria: [{ text: 'ship it' }] });
  const { binding } = await bindBranch.handler(ctx, { thread_id: thread.id, repo: 'acme/app', branch: 'feat/x' });
  assert.equal(binding.repo, 'acme/app');
});

test('bind_branch names the origin owner/name as the value to re-send when one is configured', async (t) => {
  const ctx = await makeGitToolCtx(t);
  await addOrigin(ctx, 'https://github.com/acme/app.git');
  const { thread } = await openThread.handler(ctx, { title: 'Work', completion_criteria: [{ text: 'ship it' }] });

  const error = await bindBranch
    .handler(ctx, { thread_id: thread.id, repo: 'other/repo', branch: 'feat/x' })
    .then(() => null, (raised) => raised);

  assert.equal(error.code, 'invalid_value');
  assert.equal(error.example, 'acme/app');
  assert.match(error.remedy, /re-send with acme\/app/);
});

test('bind_branch leaves a non-git ledger free to label any repository', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Work', completion_criteria: [{ text: 'ship it' }] });
  const { binding } = await bindBranch.handler(ctx, { thread_id: thread.id, repo: 'acme/app', branch: 'feat/x' });
  assert.equal(binding.repo, 'acme/app');
});

test('bind_branch rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => bindBranch.handler(ctx, { thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', repo: 'r', branch: 'b' }),
    /unknown_thread: bind_branch\.thread_id/,
  );
});
