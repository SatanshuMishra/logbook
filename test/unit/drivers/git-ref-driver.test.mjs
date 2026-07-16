import test from 'node:test';
import assert from 'node:assert/strict';
import { GitRefDriver } from '../../../src/drivers/git-ref-driver.mjs';
import { initGitRepo, makeGitDriver, initBareRemote } from '../../fixtures/git-repos.mjs';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { mintLedgerRoot } from '../../../src/drivers/git-ledger.mjs';

const DETERMINISTIC_ROOT_SHA = '2977eb960796d6bfa5f4649d708d319a9c0125e2';

test('GitRefDriver.isGit is synchronous and returns true', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  assert.equal(driver.isGit(), true);
});

test('GitRefDriver derives orphan-branch refs from the backend helpers', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  assert.equal(driver.ledgerRef, 'refs/heads/_ledger');
  assert.equal(driver.mirrorRef, 'refs/remotes/origin/_ledger');
  assert.equal(driver.fetchRefspec, '+refs/heads/_ledger:refs/remotes/origin/_ledger');
});

test('GitRefDriver rejects an unknown backend', async (t) => {
  const repo = await initGitRepo(t);
  assert.throws(
    () => new GitRefDriver({ repoDir: repo, worktreeDir: '/abs/wt', backend: 'local-dir' }),
    /unknown ledger backend/,
  );
});

test('GitRefDriver rejects a missing repoDir', () => {
  assert.throws(() => new GitRefDriver({ worktreeDir: '/abs/wt' }), /repoDir/);
});

test('GitRefDriver.root returns the worktree directory', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  assert.equal(await driver.root(), driver.worktreeDir);
});

test('init mints the deterministic orphan root on the ledger ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const { stdout } = await gitExec(repo, ['rev-list', '--max-parents=0', driver.ledgerRef]);
  assert.equal(stdout.trim(), DETERMINISTIC_ROOT_SHA);
});

test('init commits both scaffold files into the ledger ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const attrs = await gitExec(repo, ['show', `${driver.ledgerRef}:.gitattributes`]);
  assert.equal(attrs.stdout, 'sessions/**/*.md merge=union\n');
  const ignore = await gitExec(repo, ['show', `${driver.ledgerRef}:.gitignore`]);
  assert.equal(ignore.stdout, 'index/\n');
});

test('init checks out a detached worktree OUTSIDE the user repo working tree', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const s = await stat(join(driver.worktreeDir, '.gitattributes'));
  assert.equal(s.isFile(), true);
  const status = await gitExec(repo, ['status', '--porcelain']);
  assert.equal(status.stdout.trim(), '');
});

test('init is idempotent and adopts the existing ref without a new commit', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const first = (await gitExec(repo, ['rev-parse', driver.ledgerRef])).stdout.trim();
  await driver.init();
  const second = (await gitExec(repo, ['rev-parse', driver.ledgerRef])).stdout.trim();
  assert.equal(second, first);
});

test('init refuses to adopt a ref whose root is not the empty tree', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  const foreign = await mintForeignRoot(repo);
  await gitExec(repo, ['update-ref', driver.ledgerRef, foreign]);
  await assert.rejects(() => driver.init(), /not the empty tree/);
});

async function mintForeignRoot(repo) {
  await mkdir(join(repo, '.ledger-foreign'), { recursive: true });
  await writeFile(join(repo, '.ledger-foreign', 'marker'), 'foreign\n');
  await gitExec(repo, ['add', '.ledger-foreign/marker']);
  const treeSha = (await gitExec(repo, ['write-tree'])).stdout.trim();
  await gitExec(repo, ['reset', '-q']);
  return (await gitExec(
    repo,
    ['commit-tree', treeSha, '-m', 'foreign root'],
    { env: { GIT_AUTHOR_NAME: 'X', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'X', GIT_COMMITTER_EMAIL: 'x@x' } },
  )).stdout.trim();
}
