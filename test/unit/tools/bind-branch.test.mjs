import test from 'node:test';
import assert from 'node:assert/strict';
import bindBranch from '../../../src/tools/bind-branch.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import { readActiveThread } from '../../../src/util/active-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

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

test('bind_branch rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => bindBranch.handler(ctx, { thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', repo: 'r', branch: 'b' }),
    /unknown_thread: bind_branch\.thread_id/,
  );
});
