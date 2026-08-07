import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import createSuccessor from '../../../src/tools/create-successor.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import archiveThread from '../../../src/tools/archive-thread.mjs';
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

test('create_successor requires a TERMINAL predecessor', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Live', completion_criteria: [{ text: 'ship it' }] });
  await assert.rejects(
    () => createSuccessor.handler(ctx, { predecessor_id: thread.id, title: 'Next', completion_criteria: [{ text: 'go' }] }),
    /not_terminal: create_successor\.predecessor_id/,
  );
});

test('create_successor inherits parent_id and links the predecessor', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread: parent } = await openThread.handler(ctx, { title: 'Parent', completion_criteria: [{ text: 'ship it' }] });
  const { thread: pred } = await openThread.handler(ctx, { title: 'Pred', parent_id: parent.id, completion_criteria: [{ text: 'ship it' }] });
  await archiveThread.handler(ctx, { thread_id: pred.id, reason: 'superseded' });
  const { thread: succ } = await createSuccessor.handler(ctx, {
    predecessor_id: pred.id, title: 'Successor', completion_criteria: [{ text: 'finish' }],
  });
  assert.equal(succ.status, 'active');
  assert.equal(succ.predecessor_id, pred.id);
  assert.equal(succ.parent_id, parent.id);
  assert.deepEqual(succ.completion_criteria, [
    { id: 'c1', text: 'finish', done: false, kind: 'planned', struck_by: null },
  ]);
  assert.equal(await readActiveThread(ctx), succ.id);
});

test('create_successor commits and indexes the successor when the pointer write fails', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const { thread: pred } = await openThread.handler(ctx, { title: 'Pred', completion_criteria: [{ text: 'ship it' }] });
  await archiveThread.handler(ctx, { thread_id: pred.id, reason: 'superseded' });

  const result = await withUnwritablePointerDir(ctx, () => createSuccessor.handler(ctx, {
    predecessor_id: pred.id, title: 'Successor', completion_criteria: [{ text: 'finish' }],
  }));

  assert.equal(result.thread.predecessor_id, pred.id);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /active-thread pointer not written/);
  assert.match(result.warnings[0], /the pointer file is unusable \(EACCES\)/);
  assert.match(result.warnings[0], /the pointer is absent, so the end-of-session debrief gate will not fire/);
  assert.deepEqual(await ctx.driver.readThread(result.thread.id), result.thread);
  assert.ok((await ctx.driver.listThreads()).some((each) => each.id === result.thread.id));
  assert.equal((await ctx.driver.readIndexFile('by-slug'))[result.thread.slug], result.thread.id);
  assert.equal(await ledgerRefHolds(ctx, `threads/${result.thread.id}.json`), true);
});

test('create_successor rejects an unknown predecessor_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => createSuccessor.handler(ctx, { predecessor_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', title: 'X', completion_criteria: [{ text: 'a' }] }),
    /unknown_thread: create_successor\.predecessor_id/,
  );
});
