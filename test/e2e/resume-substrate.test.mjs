import test from 'node:test';
import assert from 'node:assert/strict';
import { startLedger, stopLedger, callTool } from './helpers/harness.mjs';
import { initNonGitDir, tempDir, cleanup } from './helpers/fixtures.mjs';
import { readActiveThread, readResumableIndex } from './helpers/readers.mjs';

test('a multi-thread roster counts both resumables and the brief is spine-only', async (t) => {
  const projectDir = await initNonGitDir();
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(projectDir, dataDir));
  const client = await startLedger({ projectDir, dataDir });
  t.after(() => stopLedger(client));

  const a = (await callTool(client, 'open_thread', { title: 'Alpha', completion_criteria: [{ text: 'ship it' }] })).thread;
  const b = (await callTool(client, 'open_thread', { title: 'Beta', completion_criteria: [{ text: 'ship it' }] })).thread;
  assert.equal(await readActiveThread({ projectDir, dataDir }), b.id);

  await callTool(client, 'update_thread', {
    thread_id: a.id,
    spine: { active_goal: 'alpha goal', next_step: 'alpha next step' },
  });
  await callTool(client, 'update_thread', {
    thread_id: b.id,
    spine: { active_goal: 'beta goal', next_step: 'beta next step' },
  });

  await callTool(client, 'transition_thread', { thread_id: a.id, to_status: 'paused' });
  assert.equal(await readActiveThread({ projectDir, dataDir }), b.id);

  await callTool(client, 'transition_thread', { thread_id: b.id, to_status: 'paused' });
  assert.equal(await readActiveThread({ projectDir, dataDir }), null);

  const { counts } = await callTool(client, 'rebuild_index', {});
  assert.equal(counts.resumable, 2);

  const roster = await readResumableIndex({ projectDir, dataDir });
  assert.equal(roster.length, 2);
  const betaEntry = roster.find((r) => r.id === b.id);
  assert.equal(betaEntry.next_step, 'beta next step');

  const { brief } = await callTool(client, 'get_resume_brief', { thread_id: b.id });
  assert.equal(brief.thread_id, b.id);
  assert.equal(brief.next_step, 'beta next step');
  assert.deepEqual(brief.drift, []);
});
