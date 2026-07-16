import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import appendSessionEvent from '../../../src/tools/append-session-event.mjs';
import openThread from '../../../src/tools/open-thread.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('append_session_event writes an append-only log and returns its path', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Log' });
  const { path } = await appendSessionEvent.handler(ctx, { thread_id: thread.id, actor: 'human', body: 'did work' });
  assert.equal(typeof path, 'string');
  assert.equal(await readFile(path, 'utf8'), 'did work');
});

test('append_session_event commits directly without a reindex', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'Log' });
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
    /thread_id .* does not reference an existing thread/,
  );
});
