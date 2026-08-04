import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../../../bin/ledger-cli.mjs';
import { buildContext, callTool } from '../../../src/tools/index.mjs';
import { tempDir, cleanupDirs, useEnv } from './fixtures.mjs';

async function project(t) {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });
  return { projectDir, dataDir };
}

test('briefing-pledge prints null when no briefing is outstanding', async (t) => {
  await project(t);
  assert.equal(await runCli(['briefing-pledge']), null);
});

test('briefing-pledge prints the pledge get_resume_brief left behind', async (t) => {
  await project(t);
  const ctx = await buildContext({});
  const { thread } = await callTool('open_thread', {
    title: 'Pledged',
    completion_criteria: [{ text: 'ship it' }],
  }, ctx);
  const { briefing } = await callTool('get_resume_brief', { thread_id: thread.id }, ctx);

  const pledge = await runCli(['briefing-pledge']);

  assert.equal(pledge.thread_id, thread.id);
  assert.equal(pledge.rendered, briefing);
  assert.equal(typeof pledge.rendered_at, 'string');
});

test('briefing-pledge --clear deletes the pledge and is idempotent', async (t) => {
  await project(t);
  const ctx = await buildContext({});
  const { thread } = await callTool('open_thread', {
    title: 'Pledged',
    completion_criteria: [{ text: 'ship it' }],
  }, ctx);
  await callTool('get_resume_brief', { thread_id: thread.id }, ctx);

  assert.deepEqual(await runCli(['briefing-pledge', '--clear']), { cleared: true });
  assert.equal(await runCli(['briefing-pledge']), null);
  assert.deepEqual(await runCli(['briefing-pledge', '--clear']), { cleared: false });
});

test('briefing-pledge rejects an unknown flag', async (t) => {
  await project(t);
  await assert.rejects(
    () => runCli(['briefing-pledge', '--nuke']),
    /briefing-pledge: unexpected argument --nuke/,
  );
});
