import test from 'node:test';
import assert from 'node:assert/strict';
import { isGitWorkTree, gitCommonDir, headSha } from '../../../hooks/lib/git.mjs';
import { tempDir, cleanup, initGitRepo } from './fixtures.mjs';

test('isGitWorkTree is true inside a repo and false outside', async (t) => {
  const repo = await tempDir('hooks-git-');
  const plain = await tempDir('hooks-plain-');
  cleanup(t, repo, plain);
  await initGitRepo(repo);
  assert.equal(await isGitWorkTree(repo), true);
  assert.equal(await isGitWorkTree(plain), false);
});

test('isGitWorkTree is false for an empty or invalid dir (fail-open)', async () => {
  assert.equal(await isGitWorkTree(''), false);
});

test('gitCommonDir returns an absolute path inside a repo, null outside', async (t) => {
  const repo = await tempDir('hooks-git-');
  const plain = await tempDir('hooks-plain-');
  cleanup(t, repo, plain);
  await initGitRepo(repo);
  const common = await gitCommonDir(repo);
  assert.equal(typeof common, 'string');
  assert.equal(common.startsWith('/'), true);
  assert.equal(await gitCommonDir(plain), null);
});

test('headSha resolves the HEAD commit inside a repo, null outside', async (t) => {
  const repo = await tempDir('hooks-git-');
  const plain = await tempDir('hooks-plain-');
  cleanup(t, repo, plain);
  await initGitRepo(repo);
  assert.match(await headSha(repo), /^[0-9a-f]{40}$/);
  assert.equal(await headSha(plain), null);
});
