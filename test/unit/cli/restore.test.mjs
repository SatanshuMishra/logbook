import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from '../../../bin/ledger-cli.mjs';
import { buildContext, callTool } from '../../../src/tools/index.mjs';
import { tempDir, cleanupDirs, useEnv, initGitRepo } from './fixtures.mjs';

async function seedLedgerRef(t) {
  const projectDir = await tempDir('cli-git-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });
  await initGitRepo(projectDir);
  const ctx = await buildContext({});
  const { thread } = await callTool('open_thread', { title: 'Recover Me' }, ctx);
  return { projectDir, thread };
}

test('restore materializes the ledger ref into an empty target and rebuilds the index', async (t) => {
  const { thread } = await seedLedgerRef(t);
  const target = await tempDir('cli-restore-');
  cleanupDirs(t, target);

  const result = await runCli(['restore', target]);

  assert.equal(result.ref, 'refs/heads/_ledger');
  assert.equal(result.target, target);
  assert.ok(result.restored >= 1);
  assert.equal(result.counts.threads, 1);

  const restored = JSON.parse(await readFile(join(target, 'threads', `${thread.id}.json`), 'utf8'));
  assert.equal(restored.id, thread.id);
  const resumable = JSON.parse(await readFile(join(target, 'index', 'resumable.json'), 'utf8'));
  assert.equal(resumable.length, 1);
});

test('restore refuses a non-empty target without --force, and proceeds with --force', async (t) => {
  await seedLedgerRef(t);
  const target = await tempDir('cli-restore-');
  cleanupDirs(t, target);
  await writeFile(join(target, 'occupied.txt'), 'do not clobber\n');

  await assert.rejects(() => runCli(['restore', target]), /not empty/);

  const forced = await runCli(['restore', target, '--force']);
  assert.equal(forced.counts.threads, 1);
});

test('restore reports a clear error when the ledger ref is missing', async (t) => {
  const projectDir = await tempDir('cli-git-');
  const dataDir = await tempDir('cli-data-');
  cleanupDirs(t, projectDir, dataDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataDir });
  await initGitRepo(projectDir);
  const target = await tempDir('cli-restore-');
  cleanupDirs(t, target);

  await assert.rejects(() => runCli(['restore', target]), /ledger ref refs\/heads\/_ledger not found/);
});
