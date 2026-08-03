import test from 'node:test';
import assert from 'node:assert/strict';
import { newThread } from '../../../src/model/index.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import recordDecision from '../../../src/tools/record-decision.mjs';
import { callTool, ToolValidationError } from '../../../src/tools/registry.mjs';
import { makeToolCtx, fixedClock } from '../../fixtures/tool-ctx.mjs';

const DOD = [{ text: 'ship it' }];
const WELL_FORMED_RISK = 'keep the ledger ref out of index/ — it is observer-local';

async function seedThread(ctx, criteria = DOD) {
  const { thread } = await openThread.handler(ctx, { title: 'S', completion_criteria: criteria });
  return thread;
}

test('update_thread patches spine scalars including last_session and writes no spine.status', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id,
    spine: { active_goal: 'ship v2', next_step: 'write tests', last_session: 'landed the schema' },
  });
  assert.equal(updated.spine.active_goal, 'ship v2');
  assert.equal(updated.spine.next_step, 'write tests');
  assert.equal(updated.spine.last_session, 'landed the schema');
  assert.equal('status' in updated.spine, false);
});

test('update_thread rejects spine.status as an unknown property', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => callTool('update_thread', { thread_id: thread.id, spine: { status: 'paused' } }, ctx),
    ToolValidationError,
  );
});

test('update_thread toggles completion_criteria done by id, leaving text and kind intact', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx, [{ text: 'a' }, { text: 'b' }]);
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, completion_criteria: [{ id: 'c1', done: true }],
  });
  assert.deepEqual(updated.completion_criteria, [
    { id: 'c1', text: 'a', done: true, kind: 'planned', struck_by: null },
    { id: 'c2', text: 'b', done: false, kind: 'planned', struck_by: null },
  ]);
});

test('update_thread rejects an unknown completion_criteria id, naming it', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx, [{ text: 'a' }]);
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: thread.id, completion_criteria: [{ id: 'c9', done: true }] }),
    /unknown completion_criteria id "c9"/,
  );
});

test('update_thread no longer accepts a text-matched completion_criteria patch', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx, [{ text: 'a' }]);
  await assert.rejects(
    () => callTool('update_thread', {
      thread_id: thread.id, completion_criteria: [{ text: 'a', done: true }],
    }, ctx),
    ToolValidationError,
  );
});

test('update_thread refuses a terminal thread', async (t) => {
  const ctx = await makeToolCtx(t);
  const seed = newThread({ title: 'Done', completion_criteria: DOD }, { now: fixedClock });
  await ctx.driver.writeThread({ ...seed, status: 'abandoned', abandoned_reason: 'x' });
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: seed.id, spine: { active_goal: 'y' } }),
    /cannot mutate a terminal/,
  );
});

test('update_thread enforces the 200-char active_goal cap', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => updateThread.handler(ctx, { thread_id: thread.id, spine: { active_goal: 'a'.repeat(201) } }),
    /active_goal/,
  );
});

test('update_thread accepts a well-formed two-clause risk', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, spine: { open_risks: [{ text: WELL_FORMED_RISK }] },
  });
  assert.equal(updated.spine.open_risks[0].text, WELL_FORMED_RISK);
});

test('update_thread refuses a one-clause risk, quoting the text and the shape', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id, spine: { open_risks: [{ text: 'ci is flaky' }] },
    }),
    (err) => {
      assert.match(err.message, /ci is flaky/);
      assert.match(err.message, /—/);
      return true;
    },
  );
});

test('update_thread refuses a risk joined by a hyphen instead of an em dash', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id, spine: { open_risks: [{ text: 'pin the ajv version - 8.21 breaks the compile' }] },
    }),
    /open_risks/,
  );
});

test('update_thread refuses a multi-line risk', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id, spine: { open_risks: [{ text: 'pin the ajv version — 8.21\nbreaks the compile' }] },
    }),
    /open_risks/,
  );
});

test('a stored legacy risk text never blocks an unrelated write', async (t) => {
  const ctx = await makeToolCtx(t);
  const seed = newThread({ title: 'Legacy', completion_criteria: DOD }, { now: fixedClock });
  await ctx.driver.writeThread({
    ...seed,
    spine: { ...seed.spine, open_risks: [{ text: 'a one clause legacy dump', scope: 'thread', refs: [] }] },
  });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: seed.id, spine: { next_step: 'carry on' },
  });
  assert.equal(updated.spine.next_step, 'carry on');
  assert.equal(updated.spine.open_risks[0].text, 'a one clause legacy dump');
});

test('an omitted risk scope defaults to the current criterion id', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx, [{ text: 'a' }, { text: 'b' }]);
  await updateThread.handler(ctx, { thread_id: thread.id, completion_criteria: [{ id: 'c1', done: true }] });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, spine: { open_risks: [{ text: WELL_FORMED_RISK }] },
  });
  assert.deepEqual(updated.spine.open_risks, [{ text: WELL_FORMED_RISK, scope: 'c2', refs: [] }]);
});

test('an omitted scope resolves against the criteria as toggled by the same call', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx, [{ text: 'a' }, { text: 'b' }]);
  await recordDecision.handler(ctx, {
    thread_id: thread.id, slug: 'adopt-x', title: 'Adopt X', context: 'c', options: ['x'], outcome: 'x',
  });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id,
    completion_criteria: [{ id: 'c1', done: true }],
    spine: {
      open_risks: [{ text: WELL_FORMED_RISK }],
      key_decisions: [{ ref: '0001-adopt-x', title: 'Adopt X' }],
    },
  });
  assert.deepEqual(updated.spine.open_risks, [{ text: WELL_FORMED_RISK, scope: 'c2', refs: [] }]);
  assert.deepEqual(updated.spine.key_decisions, [{ ref: '0001-adopt-x', title: 'Adopt X', scope: 'c2' }]);
});

test('a thread scope is only ever set by passing it explicitly', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id,
    spine: { open_risks: [{ text: WELL_FORMED_RISK, scope: 'thread', refs: ['src/model/caps.mjs'] }] },
  });
  assert.deepEqual(updated.spine.open_risks, [
    { text: WELL_FORMED_RISK, scope: 'thread', refs: ['src/model/caps.mjs'] },
  ]);
});

test('update_thread refuses the legacy scope on a risk and on a decision', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await recordDecision.handler(ctx, {
    thread_id: thread.id, slug: 'adopt-x', title: 'Adopt X', context: 'c', options: ['x'], outcome: 'x',
  });
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id, spine: { open_risks: [{ text: WELL_FORMED_RISK, scope: 'legacy' }] },
    }),
    /legacy/,
  );
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id,
      spine: { key_decisions: [{ ref: '0001-adopt-x', title: 'Adopt X', scope: 'legacy' }] },
    }),
    /legacy/,
  );
});

test('update_thread refuses a key_decisions ref with no decision file behind it', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id, spine: { key_decisions: [{ ref: '0042-never-written', title: 'Ghost' }] },
    }),
    /0042-never-written/,
  );
});

test('update_thread defaults a key_decisions scope to the current criterion id', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await recordDecision.handler(ctx, {
    thread_id: thread.id, slug: 'adopt-x', title: 'Adopt X', context: 'c', options: ['x'], outcome: 'x',
  });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, spine: { key_decisions: [{ ref: '0001-adopt-x', title: 'Adopt X' }] },
  });
  assert.deepEqual(updated.spine.key_decisions, [{ ref: '0001-adopt-x', title: 'Adopt X', scope: 'c1' }]);
});

test('update_thread refuses an out_of_scope entry that restates a decision title', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await recordDecision.handler(ctx, {
    thread_id: thread.id,
    slug: 'render-the-briefing-server-side',
    title: 'Render the briefing on the server, not in the model',
    context: 'c', options: ['x'], outcome: 'x',
  });
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id,
      spine: { out_of_scope: ['Render the briefing on the server, not in the model.'] },
    }),
    /out_of_scope/,
  );
});

test('an out_of_scope overlap of 23 normalized chars is accepted, since only 24 triggers the test', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await recordDecision.handler(ctx, {
    thread_id: thread.id,
    slug: 'short-title',
    title: 'aaaaa bbbbb ccccc ddddd',
    context: 'c', options: ['x'], outcome: 'x',
  });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, spine: { out_of_scope: ['aaaaa bbbbb ccccc ddddd, and more besides'] },
  });
  assert.deepEqual(updated.spine.out_of_scope, ['aaaaa bbbbb ccccc ddddd, and more besides']);
});

test('an unrelated out_of_scope entry is accepted alongside a long decision title', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await recordDecision.handler(ctx, {
    thread_id: thread.id,
    slug: 'render-the-briefing-server-side',
    title: 'Render the briefing on the server, not in the model',
    context: 'c', options: ['x'], outcome: 'x',
  });
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id, spine: { out_of_scope: ['renaming the internals to aviation terms'] },
  });
  assert.deepEqual(updated.spine.out_of_scope, ['renaming the internals to aviation terms']);
});

test('update_thread counts the open_risks cap per scope group', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const risksFor = (count, scope) => Array.from({ length: count }, (_, i) => ({
    text: `risk ${i} — because ${i}`, scope,
  }));
  const { thread: updated } = await updateThread.handler(ctx, {
    thread_id: thread.id,
    spine: { open_risks: [...risksFor(20, 'c1'), ...risksFor(20, 'thread')] },
  });
  assert.equal(updated.spine.open_risks.length, 40);
  await assert.rejects(
    () => updateThread.handler(ctx, {
      thread_id: thread.id, spine: { open_risks: risksFor(21, 'c1') },
    }),
    /open_risks/,
  );
});
