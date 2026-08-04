import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from '../../../bin/ledger-cli.mjs';
import { buildContext, callTool } from '../../../src/tools/index.mjs';
import { tempDir, cleanupDirs, useEnv, initGitRepo } from './fixtures.mjs';

test('record-sha rejects a non-sha argument', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  await assert.rejects(() => runCli(['record-sha', 'not a sha']), /record-sha: <sha>/);
  await assert.rejects(() => runCli(['record-sha']), /record-sha: <sha>/);
});

test('record-sha is a no-op with no active thread', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  const result = await runCli(['record-sha', 'abc1234']);
  assert.deepEqual(result, {});
});

test('record-sha sets first_commit once and never overwrites it', async (t) => {
  const projectDir = await tempDir('cli-git-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });
  await initGitRepo(projectDir);

  const ctx = await buildContext({});
  const { thread } = await callTool('open_thread', { title: 'Anchor Me', completion_criteria: [{ text: 'ship it' }] }, ctx);
  const { binding } = await callTool(
    'bind_branch',
    { thread_id: thread.id, repo: projectDir, branch: 'feat/anchor' },
    ctx,
  );
  assert.equal(binding.first_commit, null);

  const first = await runCli(['record-sha', 'deadbeef']);
  assert.deepEqual(first, { recovery_degraded: false });

  const ctxA = await buildContext({});
  const afterFirst = (await ctxA.driver.listBindings()).find((b) => b.id === binding.id);
  assert.equal(afterFirst.first_commit, 'deadbeef');

  await runCli(['record-sha', 'cafef00d']);
  const ctxB = await buildContext({});
  const afterSecond = (await ctxB.driver.listBindings()).find((b) => b.id === binding.id);
  assert.equal(afterSecond.first_commit, 'deadbeef');
});

test('record-sha surfaces a degraded recovery repo', async (t) => {
  const projectDir = await tempDir('cli-proj-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });

  const ctx = await buildContext({});
  const { thread } = await callTool('open_thread', { title: 'Anchor Me', completion_criteria: [{ text: 'ship it' }] }, ctx);
  await callTool('bind_branch', { thread_id: thread.id, repo: projectDir, branch: 'feat/anchor' }, ctx);

  const root = await ctx.driver.root();
  await rm(join(root, '.git'), { recursive: true, force: true });
  await writeFile(join(root, '.git'), 'not a gitfile\n');

  const result = await runCli(['record-sha', 'deadbeef']);
  assert.equal(result.recovery_degraded, true);
});
