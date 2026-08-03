import test from 'node:test';
import assert from 'node:assert/strict';
import { startLedger, stopLedger, callTool } from './helpers/harness.mjs';
import { initNonGitDir, tempDir, cleanup } from './helpers/fixtures.mjs';
import { readActiveThread, readResumableIndex } from './helpers/readers.mjs';

test('the handoff chain writes the substrate and clears the pointer on paused', async (t) => {
  const projectDir = await initNonGitDir();
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(projectDir, dataDir));
  const client = await startLedger({ projectDir, dataDir });
  t.after(() => stopLedger(client));

  const { thread } = await callTool(client, 'open_thread', { title: 'Handoff Widget', completion_criteria: [{ text: 'ship it' }] });
  assert.equal(await readActiveThread({ projectDir, dataDir }), thread.id);

  const event = await callTool(client, 'append_session_event', {
    thread_id: thread.id,
    actor: 'human',
    body: 'did the first slice of work',
  });
  assert.match(event.path, /sessions\//);

  const decision = await callTool(client, 'record_decision', {
    thread_id: thread.id,
    slug: 'use-widget',
    title: 'Use the widget',
    context: 'the gadget did not scale',
    options: ['widget', 'gadget'],
    outcome: 'widget',
  });
  assert.equal(typeof decision.number, 'string');
  assert.match(decision.path, /decisions\//);

  const refreshed = await callTool(client, 'update_thread', {
    thread_id: thread.id,
    spine: {
      active_goal: 'wire the widget end to end',
      next_step: 'add the failing integration test',
      open_risks: [{ text: 'rerun the widget suite before pushing — ci is flaky on that path' }],
      out_of_scope: ['widget docs'],
    },
  });
  assert.equal(refreshed.thread.spine.next_step, 'add the failing integration test');
  assert.deepEqual(refreshed.thread.spine.open_risks, [{
    text: 'rerun the widget suite before pushing — ci is flaky on that path',
    scope: 'c1',
    refs: [],
  }]);
  assert.deepEqual(refreshed.thread.spine.key_decisions, [
    { ref: `${decision.number}-use-widget`, title: 'Use the widget', scope: 'c1' },
  ]);

  const paused = await callTool(client, 'transition_thread', { thread_id: thread.id, to_status: 'paused' });
  assert.equal(paused.thread.status, 'paused');
  assert.equal(await readActiveThread({ projectDir, dataDir }), null);

  const { counts } = await callTool(client, 'rebuild_index', {});
  assert.equal(counts.resumable, 1);

  const roster = await readResumableIndex({ projectDir, dataDir });
  const entry = roster.find((r) => r.id === thread.id);
  assert.ok(entry, 'the handed-off thread is in the resumable roster');
  assert.equal(entry.next_step, 'add the failing integration test');
  assert.notEqual(entry.next_step.trim(), '');

  const { brief } = await callTool(client, 'get_resume_brief', { thread_id: thread.id });
  assert.equal(brief.active_goal, 'wire the widget end to end');
  assert.equal(brief.next_step, 'add the failing integration test');
});
