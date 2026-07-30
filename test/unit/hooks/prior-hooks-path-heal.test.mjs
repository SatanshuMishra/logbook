import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, chmod, symlink, access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { installCommitMsgHook } from '../../../hooks/lib/installer.mjs';
import { withGitEnv } from '../../fixtures/git-repos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const SOURCE_HOOK = join(REPO_ROOT, 'hooks', 'commit-msg');

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function initRepo(t) {
  const dir = await tempDir(t, 'prior-heal-');
  await gitExec(dir, ['init', '-q', '-b', 'main']);
  await gitExec(dir, ['config', '--local', 'user.name', 'Test User']);
  await gitExec(dir, ['config', '--local', 'user.email', 'test@example.com']);
  return dir;
}

async function persistentScopes(t, hooksPath) {
  const dir = await tempDir(t, 'prior-heal-scope-');
  const globalConfig = join(dir, 'gitconfig-global');
  const systemConfig = join(dir, 'gitconfig-system');
  await writeFile(globalConfig, hooksPath ? `[core]\n\thooksPath = ${hooksPath}\n` : '');
  await writeFile(systemConfig, '');
  return { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig };
}

async function config(repo, key) {
  const { code, stdout } = await gitExec(repo, ['config', '--local', '--get', key], { check: false });
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
}

async function writeMarkerHook(dir, name, sentinel) {
  await mkdir(dir, { recursive: true });
  const p = join(dir, name);
  await writeFile(p, `#!/bin/sh\nprintf ran > "${sentinel}"\nexit 0\n`);
  await chmod(p, 0o755);
  return p;
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function commitOnce(repo, env, name) {
  await writeFile(join(repo, name), `${name}\n`);
  await gitExec(repo, ['add', name], { env });
  return gitExec(repo, ['commit', '-m', `chore: ${name}`], { check: false, env });
}

test('install heals a latched managed dir in continuity.priorHooksPath and the inherited hook runs again', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const sentinel = join(repo, 'default-hooks-ran');
  await writeMarkerHook(join(repo, '.git', 'hooks'), 'pre-commit', sentinel);

  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.alreadyInstalled, true);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the chained pre-commit hook never ran');
  assert.equal(await readFile(sentinel, 'utf8'), 'ran');

  assert.equal(res.priorHooksPath, '');
  assert.equal(await config(repo, 'continuity.priorHooksPath'), '');
});

test('install heals a spelling of the managed dir reached through a symlinked parent', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const sentinel = join(repo, 'default-hooks-ran');
  await writeMarkerHook(join(repo, '.git', 'hooks'), 'pre-commit', sentinel);

  await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  await symlink(join(repo, 'data'), join(repo, 'linked-data'));
  const linked = join(repo, 'linked-data', 'main-key', 'githooks');
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', linked]);

  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.priorHooksPath, '');
  assert.equal(await config(repo, 'continuity.priorHooksPath'), '');

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the chained pre-commit hook never ran');
});

test('install heals a latched managed dir to the inherited hooks path when one is configured', async (t) => {
  const repo = await initRepo(t);
  const inheritedDir = await tempDir(t, 'prior-heal-inherited-');
  const scopes = await persistentScopes(t, inheritedDir);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const sentinel = join(repo, 'inherited-hooks-ran');
  await writeMarkerHook(inheritedDir, 'pre-commit', sentinel);

  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.priorHooksPath, inheritedDir);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), inheritedDir);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the inherited pre-commit hook never ran');
});

test('install leaves an honest prior hooks path untouched on the alreadyInstalled path', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const priorDir = join(repo, 'user-hooks');
  const sentinel = join(repo, 'user-hooks-ran');
  await writeMarkerHook(priorDir, 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', priorDir]);

  await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.alreadyInstalled, true);
  assert.equal(res.priorHooksPath, priorDir);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), priorDir);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the recorded prior pre-commit hook never ran');
});
