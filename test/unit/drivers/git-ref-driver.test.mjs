import test from 'node:test';
import assert from 'node:assert/strict';
import { GitRefDriver } from '../../../src/drivers/git-ref-driver.mjs';
import { initGitRepo, makeGitDriver } from '../../fixtures/git-repos.mjs';

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
