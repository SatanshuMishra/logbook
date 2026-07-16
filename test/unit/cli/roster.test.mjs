import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../../../bin/ledger-cli.mjs';
import { callTool } from '../../../src/tools/index.mjs';
import { buildContext } from '../../../src/tools/index.mjs';
import { tempDir, cleanupDirs, useEnv } from './fixtures.mjs';

test('roster returns an empty array for a fresh non-git project', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  const result = await runCli(['roster']);
  assert.deepEqual(result, []);
});

test('roster lists an active thread after open_thread', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  const ctx = await buildContext({});
  const { thread } = await callTool('open_thread', { title: 'Roster Me' }, ctx);

  const result = await runCli(['roster']);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, thread.id);
  assert.equal(result[0].status, 'active');
  assert.equal(typeof result[0].next_step, 'string');
});
