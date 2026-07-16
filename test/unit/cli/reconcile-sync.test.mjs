import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../../../bin/ledger-cli.mjs';
import { tempDir, cleanupDirs, useEnv } from './fixtures.mjs';

test('reconcile returns an empty drift envelope for a non-git project', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  const result = await runCli(['reconcile']);
  assert.deepEqual(result, { drift: [], dispositions: [] });
});

test('sync reports synced:false for a non-git LocalDriver', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  const result = await runCli(['sync']);
  assert.equal(result.synced, false);
});
