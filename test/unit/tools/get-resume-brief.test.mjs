import test from 'node:test';
import assert from 'node:assert/strict';
import getResumeBrief from '../../../src/tools/get-resume-brief.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('get_resume_brief returns a spine-only brief with resolved children and empty drift', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread: parent } = await openThread.handler(ctx, { title: 'Epic', completion_criteria: [{ text: 'ship it' }] });
  await updateThread.handler(ctx, { thread_id: parent.id, spine: { active_goal: 'ship', next_step: 'code' } });
  const { thread: child } = await openThread.handler(ctx, { title: 'Leaf', parent_id: parent.id, completion_criteria: [{ text: 'ship it' }] });
  const { brief } = await getResumeBrief.handler(ctx, { thread_id: parent.id });
  assert.equal(brief.thread_id, parent.id);
  assert.equal(brief.slug, 'epic');
  assert.equal(brief.status, 'active');
  assert.equal(brief.active_goal, 'ship');
  assert.equal(brief.next_step, 'code');
  assert.deepEqual(brief.open_risks, []);
  assert.deepEqual(brief.drift, []);
  assert.equal(brief.predecessor_id, null);
  assert.deepEqual(brief.children, [{ id: child.id, slug: 'leaf', title: 'Leaf', status: 'active' }]);
});

test('get_resume_brief hands over the drift captured since the last brief and clears only that thread', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Epic', completion_criteria: [{ text: 'ship it' }] });
  const other = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const mine = { binding_id: '01BA1', thread_id: thread.id, repo: 'acme/app', branch: 'feat/a1', classification: 'COMPLETE', signals: [{ code: 'branch-gone', classification: 'COMPLETE', detail: 'merged' }] };
  const theirs = { binding_id: '01BB1', thread_id: other, repo: 'acme/app', branch: 'feat/b1', classification: 'WARNING', signals: [] };
  await ctx.driver.writeIndexFile('drift', { [thread.id]: [mine], [other]: [theirs] });

  const first = await getResumeBrief.handler(ctx, { thread_id: thread.id });
  assert.deepEqual(first.brief.drift, [mine]);

  assert.deepEqual(await ctx.driver.readIndexFile('drift'), { [other]: [theirs] });
  const second = await getResumeBrief.handler(ctx, { thread_id: thread.id });
  assert.deepEqual(second.brief.drift, []);
});

test('get_resume_brief rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => getResumeBrief.handler(ctx, { thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
    /thread_id .* does not reference an existing thread/,
  );
});
