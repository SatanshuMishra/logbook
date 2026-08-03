import test from 'node:test';
import assert from 'node:assert/strict';
import { startLedger, stopLedger, callTool } from './helpers/harness.mjs';
import { initNonGitDir, tempDir, cleanup } from './helpers/fixtures.mjs';
import { readResumableIndex } from './helpers/readers.mjs';

test('the same tool surface runs on a non-git project at parity', async (t) => {
  const projectDir = await initNonGitDir();
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(projectDir, dataDir));
  const client = await startLedger({ projectDir, dataDir });
  t.after(() => stopLedger(client));

  const { thread } = await callTool(client, 'open_thread', { title: 'Parity', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(thread.vcs_ref, null);

  const reconcile = await callTool(client, 'reconcile', {});
  assert.deepEqual(reconcile.drift, []);
  assert.deepEqual(reconcile.dispositions, []);

  await callTool(client, 'update_thread', {
    thread_id: thread.id,
    spine: { active_goal: 'parity goal', next_step: 'parity next step' },
  });
  await callTool(client, 'transition_thread', { thread_id: thread.id, to_status: 'paused' });

  const { counts } = await callTool(client, 'rebuild_index', {});
  assert.equal(counts.resumable, 1);

  const roster = await readResumableIndex({ projectDir, dataDir });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, thread.id);
  assert.equal(roster[0].next_step, 'parity next step');

  const { brief } = await callTool(client, 'get_resume_brief', { thread_id: thread.id });
  assert.equal(brief.thread_id, thread.id);
  assert.equal(brief.next_step, 'parity next step');
});
