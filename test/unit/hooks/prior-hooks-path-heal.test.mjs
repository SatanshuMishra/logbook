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
  assert.equal(res.priorHooksPathHeal, 'unrecoverable');
  assert.equal(res.corruptPriorHooksPath, managed);
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

async function effectiveConfig(repo, env, key) {
  const { code, stdout } = await gitExec(repo, ['config', '--get', key], { check: false, env });
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
}

function install(repo, managed, env) {
  return withGitEnv(
    env,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
}

test('a valid local prior survives a copy of the same key in the global scope', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const priorDir = await tempDir(t, 'prior-heal-user-');
  const sentinel = join(repo, 'global-copy-gate-ran');
  await writeMarkerHook(priorDir, 'pre-commit', sentinel);
  const scopeDir = await tempDir(t, 'prior-heal-scope-');
  const globalConfig = join(scopeDir, 'gitconfig-global');
  const systemConfig = join(scopeDir, 'gitconfig-system');
  await writeFile(globalConfig, `[continuity]\n\tpriorHooksPath = ${priorDir}\n`);
  await writeFile(systemConfig, '');
  const scopes = { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig };
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', priorDir]);

  for (let session = 1; session <= 3; session += 1) {
    const res = await install(repo, managed, scopes);
    assert.equal(res.priorHooksPathHeal, 'not-needed', `session ${session} declared a healthy prior corrupt`);
    assert.equal(res.priorHooksPath, priorDir, `session ${session} lost the prior`);
  }
  assert.equal(await config(repo, 'continuity.priorHooksPath'), priorDir);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the valid prior gate was destroyed');
});

test('a valid worktree-scope prior is kept when the local scope carries the managed dir', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const priorDir = await tempDir(t, 'prior-heal-user-');
  const sentinel = join(repo, 'worktree-gate-ran');
  await writeMarkerHook(priorDir, 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'extensions.worktreeConfig', 'true']);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);
  await gitExec(repo, ['config', '--worktree', 'continuity.priorHooksPath', priorDir]);

  const res = await install(repo, managed, scopes);

  assert.equal(res.priorHooksPathHeal, 'not-needed');
  assert.equal(await effectiveConfig(repo, scopes, 'continuity.priorHooksPath'), priorDir);
  const worktreeRead = await gitExec(repo, ['config', '--worktree', '--get', 'continuity.priorHooksPath'], { check: false });
  assert.equal(worktreeRead.stdout.replace(/\r?\n$/, ''), priorDir, 'the good worktree value was deleted');

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the worktree-scope gate was destroyed');
});

test('a multi-valued local prior whose effective value is valid keeps the gate alive', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const priorDir = await tempDir(t, 'prior-heal-user-');
  const sentinel = join(repo, 'multi-value-gate-ran');
  await writeMarkerHook(priorDir, 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', '--add', 'continuity.priorHooksPath', managed]);
  await gitExec(repo, ['config', '--local', '--add', 'continuity.priorHooksPath', priorDir]);

  const res = await install(repo, managed, scopes);

  assert.equal(res.priorHooksPathHeal, 'not-needed');
  assert.equal(res.priorHooksPath, priorDir);
  const all = await gitExec(repo, ['config', '--local', '--get-all', 'continuity.priorHooksPath'], { check: false });
  assert.equal(all.stdout.trimEnd().split('\n').length, 1, `key is still multi-valued: ${all.stdout}`);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the effective prior gate was destroyed');
});

test('a corrupt effective value is healed onto a sibling value that still resolves', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const priorDir = await tempDir(t, 'prior-heal-user-');
  const sentinel = join(repo, 'sibling-gate-ran');
  await writeMarkerHook(priorDir, 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', '--add', 'continuity.priorHooksPath', priorDir]);
  await gitExec(repo, ['config', '--local', '--add', 'continuity.priorHooksPath', managed]);

  const res = await install(repo, managed, scopes);

  assert.equal(res.priorHooksPathHeal, 'healed');
  assert.equal(res.priorHooksPath, priorDir);

  const commit = await commitOnce(repo, scopes, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the surviving sibling value never ran');
});

test('a captured prior that no longer resolves is never reported as healed', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPathCaptured', join(repo, 'gone')]);

  const res = await install(repo, managed, scopes);

  assert.equal(res.priorHooksPathHeal, 'unrecoverable');
  assert.equal(res.priorHooksPath, '');
  assert.equal(await config(repo, 'continuity.priorHooksPathCorrupt'), managed);
});

test('a captured prior that resolves but holds no hook is never reported as healed', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const emptyDir = await tempDir(t, 'prior-heal-empty-');
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPathCaptured', emptyDir]);

  const res = await install(repo, managed, scopes);

  assert.equal(res.priorHooksPathHeal, 'unrecoverable');
  assert.equal(res.priorHooksPath, '');
});

test('a prior value carrying an embedded newline is not misread as two values', async (t) => {
  const repo = await initRepo(t);
  const scopes = await persistentScopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const priorDir = await tempDir(t, 'prior-heal-user-');
  await writeMarkerHook(priorDir, 'pre-commit', join(repo, 'newline-gate-ran'));
  const hostile = `${priorDir}\nsecond-line`;
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', hostile]);

  const res = await install(repo, managed, scopes);

  assert.equal(res.priorHooksPathHeal, 'not-needed');
  assert.equal(res.priorHooksPath, hostile);
  assert.equal(await config(repo, 'continuity.priorHooksPathCorrupt'), null);
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
