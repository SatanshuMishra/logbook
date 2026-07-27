import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isGitWorkTree, gitCommonDir, headSha } from '../../../hooks/lib/git.mjs';
import { resolveLedgerRoots } from '../../../hooks/lib/ledger-roots.mjs';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { tempDir, cleanup, initGitRepo, useEnv } from './fixtures.mjs';

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

test('gitCommonDir resolves the repo at dir despite an ambient GIT_DIR', async (t) => {
  const repo = await tempDir('hooks-git-');
  const foreign = await tempDir('hooks-foreign-');
  cleanup(t, repo, foreign);
  await initGitRepo(repo);
  await initGitRepo(foreign);
  useEnv(t, { GIT_DIR: join(foreign, '.git'), GIT_WORK_TREE: foreign });
  assert.equal(await gitCommonDir(repo), join(repo, '.git'));
});

test('isGitWorkTree stays false outside a repo despite an ambient GIT_DIR', async (t) => {
  const foreign = await tempDir('hooks-foreign-');
  const plain = await tempDir('hooks-plain-');
  cleanup(t, foreign, plain);
  await initGitRepo(foreign);
  useEnv(t, { GIT_DIR: join(foreign, '.git') });
  assert.equal(await isGitWorkTree(plain), false);
});

test('headSha reads the repo at dir despite an ambient GIT_DIR', async (t) => {
  const repo = await tempDir('hooks-git-');
  const foreign = await tempDir('hooks-foreign-');
  cleanup(t, repo, foreign);
  await initGitRepo(repo);
  await initGitRepo(foreign);
  await writeFile(join(foreign, 'foreign.md'), '# foreign\n');
  await gitExec(foreign, ['add', '.']);
  await gitExec(foreign, ['commit', '-q', '-m', 'foreign only']);
  const expected = await headSha(repo);
  useEnv(t, { GIT_DIR: join(foreign, '.git'), GIT_WORK_TREE: foreign });
  const own = await headSha(repo);
  assert.match(own, /^[0-9a-f]{40}$/);
  assert.equal(own, expected);
  assert.notEqual(own, await headSha(foreign));
});

test('resolveLedgerRoots guards the true repo despite an ambient GIT_DIR', async (t) => {
  const repo = await tempDir('hooks-git-');
  const foreign = await tempDir('hooks-foreign-');
  cleanup(t, repo, foreign);
  await initGitRepo(repo);
  await initGitRepo(foreign);
  useEnv(t, { GIT_DIR: join(foreign, '.git'), GIT_WORK_TREE: foreign });
  const roots = await resolveLedgerRoots(repo, {});
  assert.deepEqual(roots, [join(repo, '.git', 'ledger')]);
});
