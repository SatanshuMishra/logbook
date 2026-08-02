import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, chmod, copyFile, access, symlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { installCommitMsgHook, isManagedHooksDir } from '../../../hooks/lib/installer.mjs';
import { withGitEnv } from '../../fixtures/git-repos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const SOURCE_HOOK = join(REPO_ROOT, 'hooks', 'commit-msg');
const DISPATCHER = join(REPO_ROOT, 'hooks', 'dispatcher');
const MARKER = 'continuity.priorHooksPath';

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function initRepo(t) {
  const dir = await tempDir(t, 'managed-identity-');
  await gitExec(dir, ['init', '-q', '-b', 'main']);
  await gitExec(dir, ['config', '--local', 'user.name', 'Test User']);
  await gitExec(dir, ['config', '--local', 'user.email', 'test@example.com']);
  return dir;
}

async function isolatedScopes(t) {
  const dir = await tempDir(t, 'managed-identity-scope-');
  const globalConfig = join(dir, 'gitconfig-global');
  const systemConfig = join(dir, 'gitconfig-system');
  await writeFile(globalConfig, '');
  await writeFile(systemConfig, '');
  return { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig };
}

async function config(repo, key) {
  const { code, stdout } = await gitExec(repo, ['config', '--local', '--get', key], { check: false });
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
}

async function writeUserGate(dir, sentinel, mentionsMarker) {
  await mkdir(dir, { recursive: true });
  const preamble = mentionsMarker ? `git config --get ${MARKER} >/dev/null 2>&1 || true\n` : '';
  const p = join(dir, 'pre-commit');
  await writeFile(p, `#!/bin/sh\n${preamble}printf ran > "${sentinel}"\nexit 0\n`);
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

test('a user hooks dir that merely mentions the config key is not a managed hooks dir', async (t) => {
  const dir = await tempDir(t, 'managed-identity-user-');
  await writeUserGate(dir, join(dir, 'ran'), true);
  assert.equal(await isManagedHooksDir(dir), false);
});

test('a dir installed by installCommitMsgHook is a managed hooks dir', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  assert.equal(await isManagedHooksDir(managed), true);
});

test('a copy of a managed hooks dir at another path is not that managed hooks dir', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  const copied = join(repo, 'copied-githooks');
  await mkdir(copied, { recursive: true });
  await copyFile(join(managed, 'pre-commit'), join(copied, 'pre-commit'));
  await copyFile(join(managed, '.continuity-managed-hooks'), join(copied, '.continuity-managed-hooks'));
  assert.equal(await isManagedHooksDir(copied), false);
});

test('a user gate that mentions the config key survives a later install and still runs', async (t) => {
  const repo = await initRepo(t);
  const scopes = await isolatedScopes(t);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const userHooks = join(repo, '.githooks');
  const sentinel = join(repo, 'user-gate-ran');
  await writeUserGate(userHooks, sentinel, false);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', userHooks]);

  const first = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
  assert.equal(first.priorHooksPath, userHooks);

  await writeUserGate(userHooks, sentinel, true);

  const second = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(second.priorHooksPath, userHooks, 'the user gate was reclassified as a managed dir');
  assert.equal(await config(repo, 'continuity.priorHooksPath'), userHooks);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the user gate never ran');
});

test('a first install captures a user gate whose body calls the config key', async (t) => {
  const repo = await initRepo(t);
  const scopes = await isolatedScopes(t);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const userHooks = join(repo, '.githooks');
  const sentinel = join(repo, 'user-gate-ran');
  await writeUserGate(userHooks, sentinel, true);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', userHooks]);

  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.priorHooksPathCapture, 'captured', 'the first install declined to capture the user gate');
  assert.equal(res.priorHooksPath, userHooks);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), userHooks);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the user gate never ran');
});

test('a first install captures a user gate reached through a symlinked hooks dir', async (t) => {
  const repo = await initRepo(t);
  const scopes = await isolatedScopes(t);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const userHooks = join(repo, 'real-githooks');
  const linked = join(repo, 'linked-githooks');
  const sentinel = join(repo, 'symlinked-gate-ran');
  await writeUserGate(userHooks, sentinel, true);
  await symlink(userHooks, linked);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', linked]);

  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.priorHooksPathCapture, 'captured');
  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the symlinked user gate never ran');
});

test('a user hooks dir sitting under the data root is captured unless its parent is a project key', async (t) => {
  const repo = await initRepo(t);
  const scopes = await isolatedScopes(t);
  const dataRoot = await tempDir(t, 'managed-identity-data-');
  const managed = join(dataRoot, 'main-key', 'githooks');
  const userHooks = join(dataRoot, 'dotfiles', 'githooks');
  const sentinel = join(repo, 'data-root-neighbour-ran');
  await writeUserGate(userHooks, sentinel, true);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', userHooks]);

  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.priorHooksPathCapture, 'captured', 'a neighbour of the data root was claimed as managed');
  assert.equal(res.priorHooksPath, userHooks);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the gate next door to the data root never ran');
});

test('a declined capture is recorded under its own key rather than passing silently', async (t) => {
  const repo = await initRepo(t);
  const scopes = await isolatedScopes(t);
  const legacyManaged = join(repo, 'data', 'legacy-key', 'githooks');
  await mkdir(legacyManaged, { recursive: true });
  await gitExec(repo, ['config', '--local', 'core.hooksPath', legacyManaged]);

  const managed = join(repo, 'data', 'main-key', 'githooks');
  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.priorHooksPathCapture, 'declined-managed');
  assert.equal(res.declinedHooksPath, legacyManaged);
  assert.equal(await config(repo, 'continuity.priorHooksPathDeclined'), legacyManaged);
});

test('a legacy managed dir carrying no sentinel and no dispatcher content is still declined', async (t) => {
  const repo = await initRepo(t);
  const scopes = await isolatedScopes(t);
  const legacyManaged = join(repo, 'data', 'legacy-key', 'githooks');
  await mkdir(legacyManaged, { recursive: true });
  await writeFile(join(legacyManaged, 'pre-commit'), '#!/bin/sh\nexit 0\n');
  await chmod(join(legacyManaged, 'pre-commit'), 0o755);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', '']);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', legacyManaged]);

  const managed = join(repo, 'data', 'main-key', 'githooks');
  const res = await withGitEnv(
    scopes,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );

  assert.equal(res.priorHooksPath, '', 'a legacy managed dir was captured as the user prior');
  assert.equal(await config(repo, 'continuity.priorHooksPath'), '');
});
