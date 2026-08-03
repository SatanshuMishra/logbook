import test from 'node:test';
import assert from 'node:assert/strict';
import { newThread } from '../../../src/model/index.mjs';
import amendCriteria from '../../../src/tools/amend-criteria.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import updateThread from '../../../src/tools/update-thread.mjs';
import recordDecision from '../../../src/tools/record-decision.mjs';
import { callTool, ToolValidationError } from '../../../src/tools/registry.mjs';
import { makeToolCtx, fixedClock } from '../../fixtures/tool-ctx.mjs';

const PAIR = [{ text: 'a' }, { text: 'b' }];

async function seedThread(ctx, criteria = PAIR) {
  const { thread } = await openThread.handler(ctx, { title: 'Amend', completion_criteria: criteria });
  return thread;
}

async function seedDecision(ctx, threadId, slug = 'the-plan-was-wrong') {
  const { number } = await recordDecision.handler(ctx, {
    thread_id: threadId,
    slug,
    title: 'The plan was wrong',
    context: 'c',
    options: ['x'],
    outcome: 'x',
  });
  return `${number}-${slug}`;
}

const ids = (thread) => thread.completion_criteria.map((c) => c.id);

test('a struck criterion is retained and its id is never reused by a later insert', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const ref = await seedDecision(ctx, thread.id);
  await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'strike', id: 'c2', decision_ref: ref }],
  });
  const { thread: updated } = await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'insert', text: 'c', kind: 'planned' }],
  });
  assert.deepEqual(ids(updated), ['c1', 'c2', 'c3']);
  assert.deepEqual(updated.completion_criteria[1], {
    id: 'c2', text: 'b', done: false, kind: 'planned', struck_by: ref,
  });
  assert.deepEqual(updated.completion_criteria[2], {
    id: 'c3', text: 'c', done: false, kind: 'planned', struck_by: null,
  });
});

test('a detour with no before lands immediately ahead of the current criterion', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx, [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
  await updateThread.handler(ctx, {
    thread_id: thread.id, completion_criteria: [{ id: 'c1', done: true }],
  });
  const { thread: updated } = await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'insert', text: 'unpin the flaky fixture', kind: 'detour' }],
  });
  assert.deepEqual(ids(updated), ['c1', 'c4', 'c2', 'c3']);
  assert.equal(updated.completion_criteria[1].kind, 'detour');
});

test('an explicit before overrides the placement for a planned insert', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const { thread: updated } = await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'insert', text: 'first', kind: 'planned', before: 'c1' }],
  });
  assert.deepEqual(ids(updated), ['c3', 'c1', 'c2']);
});

test('a second open detour is refused toward a child thread, and allowed once the first is done', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'insert', text: 'unpin the flaky fixture', kind: 'detour' }],
  });
  await assert.rejects(
    () => amendCriteria.handler(ctx, {
      thread_id: thread.id, operations: [{ op: 'insert', text: 'and rewrite the harness', kind: 'detour' }],
    }),
    (err) => {
      assert.match(err.message, /"c3"/);
      assert.match(err.message, /child thread/);
      return true;
    },
  );
  await updateThread.handler(ctx, {
    thread_id: thread.id, completion_criteria: [{ id: 'c3', done: true }],
  });
  const { thread: updated } = await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'insert', text: 'and rewrite the harness', kind: 'detour' }],
  });
  assert.equal(updated.completion_criteria.filter((c) => c.kind === 'detour').length, 2);
});

test('rewrite and strike are refused without a decision_ref', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => callTool('amend_criteria', {
      thread_id: thread.id, operations: [{ op: 'rewrite', id: 'c1', text: 'a, revised' }],
    }, ctx),
    ToolValidationError,
  );
  await assert.rejects(
    () => callTool('amend_criteria', {
      thread_id: thread.id, operations: [{ op: 'strike', id: 'c1' }],
    }, ctx),
    ToolValidationError,
  );
});

test('a decision_ref with no decision file behind it is refused, naming the ref', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await assert.rejects(
    () => amendCriteria.handler(ctx, {
      thread_id: thread.id, operations: [{ op: 'strike', id: 'c1', decision_ref: '0042-never-written' }],
    }),
    /0042-never-written/,
  );
});

test('rewrite replaces the text behind a recorded decision, keeping id, kind and done', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const ref = await seedDecision(ctx, thread.id);
  await updateThread.handler(ctx, {
    thread_id: thread.id, completion_criteria: [{ id: 'c1', done: true }],
  });
  const { thread: updated } = await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'rewrite', id: 'c1', text: 'a, as actually shipped', decision_ref: ref }],
  });
  assert.deepEqual(updated.completion_criteria[0], {
    id: 'c1', text: 'a, as actually shipped', done: true, kind: 'planned', struck_by: null,
  });
});

test('an operation naming an unknown criterion id is refused, naming it', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const ref = await seedDecision(ctx, thread.id);
  await assert.rejects(
    () => amendCriteria.handler(ctx, {
      thread_id: thread.id, operations: [{ op: 'rewrite', id: 'c9', text: 'ghost', decision_ref: ref }],
    }),
    /"c9"/,
  );
  await assert.rejects(
    () => amendCriteria.handler(ctx, {
      thread_id: thread.id, operations: [{ op: 'insert', text: 'ghost', kind: 'planned', before: 'c9' }],
    }),
    /"c9"/,
  );
});

test('a struck criterion refuses further amendment, naming the decision that struck it', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const ref = await seedDecision(ctx, thread.id);
  await amendCriteria.handler(ctx, {
    thread_id: thread.id, operations: [{ op: 'strike', id: 'c2', decision_ref: ref }],
  });
  await assert.rejects(
    () => amendCriteria.handler(ctx, {
      thread_id: thread.id, operations: [{ op: 'rewrite', id: 'c2', text: 'b again', decision_ref: ref }],
    }),
    new RegExp(ref),
  );
});

test('a failure partway through the operations rolls the whole call back', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const ref = await seedDecision(ctx, thread.id);
  const before = await ctx.driver.readThread(thread.id);
  await assert.rejects(
    () => amendCriteria.handler(ctx, {
      thread_id: thread.id,
      operations: [
        { op: 'insert', text: 'this one is valid', kind: 'planned' },
        { op: 'strike', id: 'c9', decision_ref: ref },
      ],
    }),
    /operations\[1\]/,
  );
  const stored = await ctx.driver.readThread(thread.id);
  assert.deepEqual(stored.completion_criteria, before.completion_criteria);
  assert.equal(stored.updated_at, before.updated_at);
});

test('amend_criteria refuses a terminal thread', async (t) => {
  const ctx = await makeToolCtx(t);
  const seed = newThread({ title: 'Done', completion_criteria: [{ text: 'ship it' }] }, { now: fixedClock });
  await ctx.driver.writeThread({ ...seed, status: 'abandoned', abandoned_reason: 'x' });
  await assert.rejects(
    () => amendCriteria.handler(ctx, {
      thread_id: seed.id, operations: [{ op: 'insert', text: 'too late', kind: 'planned' }],
    }),
    /cannot mutate a terminal/,
  );
});
