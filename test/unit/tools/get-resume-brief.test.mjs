import test from 'node:test';
import assert from 'node:assert/strict';
import getResumeBrief from '../../../src/tools/get-resume-brief.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import rebuildIndexTool from '../../../src/tools/rebuild-index.mjs';
import { makeToolCtx, FIXED } from '../../fixtures/tool-ctx.mjs';

async function seedThread(ctx) {
  const { thread } = await openThread.handler(ctx, {
    title: 'Epic',
    completion_criteria: [{ text: 'set up the harness' }, { text: 'wire the adapter' }],
  });
  await updateThread.handler(ctx, {
    thread_id: thread.id,
    completion_criteria: [{ id: 'c1', done: true }],
    spine: {
      active_goal: 'ship the widget end to end',
      next_step: 'add the failing integration test',
      open_risks: [{ text: 'rerun the widget suite — ci is flaky on that path' }],
      out_of_scope: ['widget documentation'],
    },
  });
  return thread;
}

test('get_resume_brief returns the rendered briefing and nothing else', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);

  const response = await getResumeBrief.handler(ctx, { thread_id: thread.id });

  assert.deepEqual(Object.keys(response).sort(), ['briefing', 'thread_id']);
  assert.equal(response.thread_id, thread.id);
  assert.equal(typeof response.briefing, 'string');
});

test('the briefing carries the header, the progress fraction and the current step content', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);

  const { briefing } = await getResumeBrief.handler(ctx, { thread_id: thread.id });

  assert.ok(briefing.startsWith('# PREFLIGHT BRIEFING — Epic\n'));
  assert.ok(briefing.includes('active · 1 of 2 done · 0 detour(s) open · last worked 2026-07-15'));
  assert.ok(briefing.includes('## WHY\nship the widget end to end'));
  assert.ok(briefing.includes('- [x] c1 — set up the harness'));
  assert.ok(briefing.includes('- [>] c2 — wire the adapter'));
  assert.ok(briefing.includes('## NEXT STEP\nadd the failing integration test'));
  assert.ok(briefing.includes('## WATCH OUT FOR\n- rerun the widget suite — ci is flaky on that path'));
  assert.ok(briefing.includes('## NOT IN SCOPE\n- widget documentation'));
  assert.ok(briefing.includes('Ask for any decision by number: read_decision.'));
});

test('the briefing names child threads and the predecessor under RELATED', async (t) => {
  const ctx = await makeToolCtx(t);
  const parent = await seedThread(ctx);
  const { thread: ancestor } = await openThread.handler(ctx, {
    title: 'Ancestor',
    completion_criteria: [{ text: 'ship it' }],
  });
  await openThread.handler(ctx, {
    title: 'Leaf',
    parent_id: parent.id,
    completion_criteria: [{ text: 'ship it' }],
  });
  const { thread: successor } = await openThread.handler(ctx, {
    title: 'Successor',
    predecessor_id: ancestor.id,
    completion_criteria: [{ text: 'ship it' }],
  });

  const parentBrief = await getResumeBrief.handler(ctx, { thread_id: parent.id });
  assert.ok(parentBrief.briefing.includes('## RELATED\n- child: leaf (active)'));

  const successorBrief = await getResumeBrief.handler(ctx, { thread_id: successor.id });
  assert.ok(successorBrief.briefing.includes('## RELATED\n- succeeds: ancestor'));
});

test('a thread with no drift snapshot omits SINCE YOU LEFT rather than failing', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  assert.deepEqual(await ctx.driver.readIndexFile('drift'), {});

  const { briefing } = await getResumeBrief.handler(ctx, { thread_id: thread.id });

  assert.equal(briefing.includes('## SINCE YOU LEFT'), false);
});

test('a drift snapshot for the thread renders SINCE YOU LEFT', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await ctx.driver.writeIndexFile('drift', {
    [thread.id]: [{
      binding_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      thread_id: thread.id,
      repo: '/repo',
      branch: 'feat/widget',
      classification: 'WARNING',
      signals: [{ code: 'divergence', classification: 'WARNING', detail: 'ahead 2, behind 1' }],
    }],
  });

  const { briefing } = await getResumeBrief.handler(ctx, { thread_id: thread.id });

  assert.ok(briefing.includes('## SINCE YOU LEFT\n- WARNING feat/widget — divergence: ahead 2, behind 1'));
});

test('get_resume_brief pledges the exact rendered text and rebuild_index preserves it', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);

  const { briefing } = await getResumeBrief.handler(ctx, { thread_id: thread.id });

  assert.deepEqual(await ctx.driver.readIndexFile('briefing'), {
    thread_id: thread.id,
    rendered: briefing,
    rendered_at: FIXED,
  });

  await rebuildIndexTool.handler(ctx, {});
  const survived = await ctx.driver.readIndexFile('briefing');
  assert.equal(survived.rendered, briefing);
});

test('get_resume_brief rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => getResumeBrief.handler(ctx, { thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
    /thread_id .* does not reference an existing thread/,
  );
});
