import test from 'node:test';
import assert from 'node:assert/strict';
import { startLedger, stopLedger, callTool, expectToolError } from './helpers/harness.mjs';
import { initNonGitDir, tempDir, cleanup } from './helpers/fixtures.mjs';

async function freshLedger(t) {
  const projectDir = await initNonGitDir();
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(projectDir, dataDir));
  const client = await startLedger({ projectDir, dataDir });
  t.after(() => stopLedger(client));
  return client;
}

test('the server refuses a transition absent from the FSM matrix', async (t) => {
  const client = await freshLedger(t);
  const { thread } = await callTool(client, 'open_thread', { title: 'FSM Guard', completion_criteria: [{ text: 'ship it' }] });
  const paused = await callTool(client, 'transition_thread', { thread_id: thread.id, to_status: 'paused' });
  assert.equal(paused.thread.status, 'paused');

  const err = await expectToolError(client, 'transition_thread', { thread_id: thread.id, to_status: 'blocked' });
  assert.equal(err.error, 'ToolError');
  assert.match(err.message, /illegal transition paused -> blocked/);
});

test('the server refuses opening a thread without a definition of done', async (t) => {
  const client = await freshLedger(t);

  const missing = await expectToolError(client, 'open_thread', { title: 'No Criteria' });
  assert.match(missing.message, /completion_criteria/);

  const empty = await expectToolError(client, 'open_thread', {
    title: 'No Criteria',
    completion_criteria: [],
  });
  assert.match(empty.message, /completion_criteria/);
});

test('the multi-session path reaches done after checking off a criterion', async (t) => {
  const client = await freshLedger(t);
  const { thread } = await callTool(client, 'open_thread', {
    title: 'Shippable',
    completion_criteria: [{ text: 'ship the widget' }],
  });
  assert.equal(thread.completion_criteria[0].id, 'c1');

  const early = await expectToolError(client, 'transition_thread', {
    thread_id: thread.id,
    to_status: 'done',
    closure_statement: 'done and dusted',
  });
  assert.match(early.message, /every completion_criteria entry must be done:true for done/);

  const checked = await callTool(client, 'update_thread', {
    thread_id: thread.id,
    completion_criteria: [{ id: 'c1', done: true }],
  });
  assert.equal(checked.thread.completion_criteria[0].done, true);

  const done = await callTool(client, 'transition_thread', {
    thread_id: thread.id,
    to_status: 'done',
    closure_statement: 'done and dusted',
  });
  assert.equal(done.thread.status, 'done');
  assert.equal(done.thread.closure_statement, 'done and dusted');
});
