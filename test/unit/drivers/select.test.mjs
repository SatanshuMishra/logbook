import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { selectDriver, isGitWorkTreeSync } from '../../../src/drivers/select.mjs';
import { GitRefDriver } from '../../../src/drivers/git-ref-driver.mjs';
import { LocalDriver } from '../../../src/drivers/local-driver.mjs';
import { initGitRepo, makeTempDir } from '../../fixtures/git-repos.mjs';
import { projectKey } from '../../../src/util/project-key.mjs';

function withDataDir(t) {
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  t.after(() => {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  });
}

test('isGitWorkTreeSync is true inside a git work tree and false outside', async (t) => {
  const repo = await initGitRepo(t);
  const plain = await makeTempDir(t, 'select-nongit-');
  assert.equal(isGitWorkTreeSync(repo), true);
  assert.equal(isGitWorkTreeSync(plain), false);
});

test('selectDriver returns a GitRefDriver for a git project with the pinned construction', async (t) => {
  withDataDir(t);
  const repo = await initGitRepo(t);
  const dataDir = await makeTempDir(t, 'select-data-');
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  const driver = selectDriver(repo, {});
  assert.ok(driver instanceof GitRefDriver);
  assert.equal(driver.repoDir, repo);
  assert.equal(driver.backend, 'orphan-branch');
  assert.equal(driver.branch, '_ledger');
  assert.equal(driver.remote, 'origin');
  assert.equal(driver.worktreeDir, join(dataDir, projectKey(repo), 'ledger-worktree'));
});

test('selectDriver honors userConfig backend and branch', async (t) => {
  withDataDir(t);
  const repo = await initGitRepo(t);
  const dataDir = await makeTempDir(t, 'select-data-');
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  const driver = selectDriver(repo, { ledger_backend: 'custom-ref', ledger_branch: 'notes' });
  assert.ok(driver instanceof GitRefDriver);
  assert.equal(driver.backend, 'custom-ref');
  assert.equal(driver.branch, 'notes');
  assert.equal(driver.ledgerRef, 'refs/ledger/notes');
});

test('selectDriver returns a LocalDriver for a non-git project', async (t) => {
  withDataDir(t);
  const plain = await makeTempDir(t, 'select-nongit-');
  const dataDir = await makeTempDir(t, 'select-data-');
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  const driver = selectDriver(plain, {});
  assert.ok(driver instanceof LocalDriver);
  assert.equal(driver.isGit(), false);
  assert.equal(await driver.root(), join(dataDir, projectKey(plain), 'ledger'));
});

test('selectDriver throws when CLAUDE_PLUGIN_DATA is unset', async (t) => {
  withDataDir(t);
  const repo = await initGitRepo(t);
  delete process.env.CLAUDE_PLUGIN_DATA;
  assert.throws(() => selectDriver(repo, {}), /CLAUDE_PLUGIN_DATA/);
});

test('selectDriver never git-inits a non-git project', async (t) => {
  withDataDir(t);
  const plain = await makeTempDir(t, 'select-nongit-');
  const dataDir = await makeTempDir(t, 'select-data-');
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  selectDriver(plain, {});
  assert.equal(isGitWorkTreeSync(plain), false);
});
