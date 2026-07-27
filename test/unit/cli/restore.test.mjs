import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runCli } from '../../../bin/ledger-cli.mjs';
import { buildContext, callTool } from '../../../src/tools/index.mjs';
import { tempDir, cleanupDirs, useEnv, initGitRepo } from './fixtures.mjs';

function git(repo, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`));
          return;
        }
        resolvePromise(stdout);
      },
    );
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function hashBlob(repo, content) {
  const out = await git(repo, ['hash-object', '-w', '--stdin'], content);
  return out.trim();
}

async function updateLedgerRef(repo, tree) {
  const commit = (await git(repo, ['commit-tree', tree, '-m', 'crafted'])).trim();
  await git(repo, ['update-ref', 'refs/heads/_ledger', commit]);
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

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
  assert.equal(await pathExists(join(target, '.git')), false);
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

test('restore refuses a ledger tree entry that escapes the target (path traversal)', async (t) => {
  const projectDir = await tempDir('cli-git-');
  cleanupDirs(t, projectDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir });
  await initGitRepo(projectDir);

  const blob = await hashBlob(projectDir, 'pwned\n');
  const sub = (await git(projectDir, ['mktree'], `100644 blob ${blob}\tpwned.txt\n`)).trim();
  const top = (await git(projectDir, ['mktree', '--missing'], `040000 tree ${sub}\t..\n`)).trim();
  await updateLedgerRef(projectDir, top);

  const target = await tempDir('cli-restore-');
  cleanupDirs(t, target);
  const escaped = join(dirname(target), 'pwned.txt');

  await assert.rejects(() => runCli(['restore', target]), /escapes target|parent-directory segment/);
  assert.equal(await pathExists(escaped), false);
});

test('restore skips non-blob (symlink) tree entries instead of materializing them', async (t) => {
  const projectDir = await tempDir('cli-git-');
  cleanupDirs(t, projectDir);
  useEnv(t, { CLAUDE_PROJECT_DIR: projectDir });
  await initGitRepo(projectDir);

  const linkBlob = await hashBlob(projectDir, '/etc/passwd');
  const dataBlob = await hashBlob(projectDir, 'safe\n');
  const tree = (await git(
    projectDir,
    ['mktree'],
    `120000 blob ${linkBlob}\tevil.link\n100644 blob ${dataBlob}\tkeep.txt\n`,
  )).trim();
  await updateLedgerRef(projectDir, tree);

  const target = await tempDir('cli-restore-');
  cleanupDirs(t, target);

  const result = await runCli(['restore', target]);

  assert.equal(result.restored, 1);
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'safe\n');
  assert.equal(await pathExists(join(target, 'evil.link')), false);
});
