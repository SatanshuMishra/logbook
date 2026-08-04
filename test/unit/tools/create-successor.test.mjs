import test from 'node:test';
import assert from 'node:assert/strict';
import createSuccessor from '../../../src/tools/create-successor.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import archiveThread from '../../../src/tools/archive-thread.mjs';
import { readActiveThread } from '../../../src/util/active-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

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

test('create_successor rejects an unknown predecessor_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => createSuccessor.handler(ctx, { predecessor_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', title: 'X', completion_criteria: [{ text: 'a' }] }),
    /unknown_thread: create_successor\.predecessor_id/,
  );
});
