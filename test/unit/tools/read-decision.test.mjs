import test from 'node:test';
import assert from 'node:assert/strict';
import readDecision from '../../../src/tools/read-decision.mjs';
import recordDecision from '../../../src/tools/record-decision.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

async function seedDecision(ctx, slug, title) {
  const { thread } = await openThread.handler(ctx, {
    title: 'Decisions',
    completion_criteria: [{ text: 'ship it' }],
  });
  const { number } = await recordDecision.handler(ctx, {
    thread_id: thread.id,
    slug,
    title,
    context: 'the gadget did not scale',
    options: ['widget', 'gadget'],
    outcome: 'widget',
  });
  return { thread, number };
}

test('read_decision returns the number, the slug and the record markdown', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread, number } = await seedDecision(ctx, 'use-widget', 'Use the widget');

  const decision = await readDecision.handler(ctx, { nnnn: number });

  assert.deepEqual(Object.keys(decision).sort(), ['markdown', 'nnnn', 'slug']);
  assert.equal(decision.nnnn, number);
  assert.equal(decision.slug, 'use-widget');
  assert.ok(decision.markdown.includes(`# ${number}. Use the widget`));
  assert.ok(decision.markdown.includes(`Thread-Id: ${thread.id}`));
});

test('read_decision resolves the number a briefing prints for a decision ref', async (t) => {
  const ctx = await makeToolCtx(t);
  const { number } = await seedDecision(ctx, 'use-widget', 'Use the widget');
  const [nnnn] = `${number}-use-widget`.split('-');

  const decision = await readDecision.handler(ctx, { nnnn });

  assert.equal(decision.slug, 'use-widget');
});

test('read_decision rejects a number no decision file carries', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => readDecision.handler(ctx, { nnnn: '0042' }),
    /no decision numbered "0042" exists here/,
  );
});
