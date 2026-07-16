import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../../../bin/ledger-cli.mjs';
import { tempDir, cleanupDirs, useEnv } from './fixtures.mjs';

test('active-thread returns thread_id null for a fresh non-git project', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  const result = await runCli(['active-thread']);
  assert.deepEqual(result, { thread_id: null });
});

test('runCli rejects an unknown subcommand with a usage message', async () => {
  await assert.rejects(() => runCli(['destroy-everything']), /usage: ledger-cli/);
});

test('runCli rejects a missing subcommand', async () => {
  await assert.rejects(() => runCli([]), /usage: ledger-cli/);
});
