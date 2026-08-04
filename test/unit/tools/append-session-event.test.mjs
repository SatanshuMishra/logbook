import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import appendSessionEvent from '../../../src/tools/append-session-event.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('append_session_event writes an append-only log and returns its path', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Log', completion_criteria: [{ text: 'ship it' }] });
  const { path } = await appendSessionEvent.handler(ctx, { thread_id: thread.id, actor: 'human', body: 'did work' });
  assert.equal(typeof path, 'string');
  assert.equal(await readFile(path, 'utf8'), 'did work');
});

test('append_session_event commits directly without a reindex', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Log', completion_criteria: [{ text: 'ship it' }] });
  let commits = 0;
  let indexWrites = 0;
  ctx.driver.commit = async () => { commits += 1; return { committed: false }; };
  const origWriteIndex = ctx.driver.writeIndexFile.bind(ctx.driver);
  ctx.driver.writeIndexFile = async (n, o) => { indexWrites += 1; return origWriteIndex(n, o); };
  await appendSessionEvent.handler(ctx, { thread_id: thread.id, actor: 'ledger', body: 'note' });
  assert.equal(commits, 1);
  assert.equal(indexWrites, 0);
});

test('append_session_event rejects an unknown thread_id', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => appendSessionEvent.handler(ctx, { thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', actor: 'human', body: 'x' }),
    /unknown_thread: append_session_event\.thread_id/,
  );
});

test('append_session_event reports recovery_degraded when the recovery repo is gone', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Log', completion_criteria: [{ text: 'ship it' }] });
  const healthy = await appendSessionEvent.handler(ctx, { thread_id: thread.id, actor: 'human', body: 'ok' });
  assert.equal(healthy.recovery_degraded, false);
  await rm(join(await ctx.driver.root(), '.git'), { recursive: true, force: true });
  const degraded = await appendSessionEvent.handler(ctx, { thread_id: thread.id, actor: 'human', body: 'gone' });
  assert.equal(degraded.recovery_degraded, true);
  assert.equal(typeof degraded.path, 'string');
});
