import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { installCommitMsgHook, managedHooksDir } from '../../../hooks/lib/installer.mjs';
import { handleSessionStart } from '../../../hooks/lib/session-start.mjs';
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
  const dir = await tempDir(t, 'prior-report-');
  await gitExec(dir, ['init', '-q', '-b', 'main']);
  await gitExec(dir, ['config', '--local', 'user.name', 'Test User']);
  await gitExec(dir, ['config', '--local', 'user.email', 'test@example.com']);
  return dir;
}

async function scopes(t, hooksPath) {
  const dir = await tempDir(t, 'prior-report-scope-');
  const globalConfig = join(dir, 'gitconfig-global');
  const systemConfig = join(dir, 'gitconfig-system');
  await writeFile(globalConfig, hooksPath ? `[core]\n\thooksPath = ${hooksPath}\n` : '');
  await writeFile(systemConfig, '');
  return { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig };
}

async function localConfig(repo, key) {
  const { code, stdout } = await gitExec(repo, ['config', '--local', '--get', key], { check: false });
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
}

async function effectiveConfig(repo, env, key) {
  const { code, stdout } = await gitExec(repo, ['config', '--get', key], { check: false, env });
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

function install(repo, managed, env) {
  return withGitEnv(
    env,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
}

test('a corrupt prior does not report once per hook invocation across a whole commit', async (t) => {
  const repo = await initRepo(t);
  const env = await scopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  await install(repo, managed, env);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const commit = await commitOnce(repo, env, 'seed.txt');

  assert.equal(commit.code, 0, commit.stderr);
  const reported = commit.stderr.split('\n').filter((l) => l.startsWith('continuity:'));
  assert.equal(reported.some((l) => l.includes('reference-transaction')), false, commit.stderr);
  assert.equal(reported.some((l) => l.includes('post-index-change')), false, commit.stderr);
  assert.ok(reported.length <= 4, `hook chain reported ${reported.length} times: ${commit.stderr}`);
});

test('an unrecoverable corrupt prior reports the state instead of claiming success', async (t) => {
  const repo = await initRepo(t);
  const env = await scopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const res = await install(repo, managed, env);

  assert.equal(res.alreadyInstalled, true);
  assert.equal(res.priorHooksPathHeal, 'unrecoverable');
  assert.equal(res.corruptPriorHooksPath, managed);
  assert.equal(await localConfig(repo, 'continuity.priorHooksPathCorrupt'), managed);
});

test('a repo-local prior captured by an earlier install is restored and the gate runs again', async (t) => {
  const repo = await initRepo(t);
  const env = await scopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const sentinel = join(repo, 'repo-local-gate-ran');
  await writeMarkerHook(join(repo, '.githooks'), 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', '.githooks']);

  await install(repo, managed, env);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const res = await install(repo, managed, env);

  assert.equal(res.priorHooksPathHeal, 'healed');
  assert.equal(res.priorHooksPath, join(repo, '.githooks'));

  const commit = await commitOnce(repo, env, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the repo-local gate never ran after the heal');
});

test('a multi-valued prior key is detected as corrupt and collapsed to a single value', async (t) => {
  const repo = await initRepo(t);
  const env = await scopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const priorDir = join(repo, 'user-hooks');
  const sentinel = join(repo, 'user-hooks-ran');
  await writeMarkerHook(priorDir, 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', '--add', 'continuity.priorHooksPath', priorDir]);
  await gitExec(repo, ['config', '--local', '--add', 'continuity.priorHooksPath', managed]);

  const res = await install(repo, managed, env);

  assert.notEqual(res.priorHooksPathHeal, 'failed');
  const all = await gitExec(repo, ['config', '--local', '--get-all', 'continuity.priorHooksPath'], { check: false });
  assert.equal(all.stdout.trimEnd().split('\n').length, 1, `key is still multi-valued: ${all.stdout}`);

  const commit = await commitOnce(repo, env, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
});

test('a failed heal write is reported rather than swallowed', async (t) => {
  const repo = await initRepo(t);
  const env = await scopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);
  const lockFile = join(repo, '.git', 'config.lock');
  await writeFile(lockFile, '');
  t.after(() => rm(lockFile, { force: true }));

  const res = await install(repo, managed, env);

  assert.equal(res.priorHooksPathHeal, 'failed');
  assert.equal(res.priorHooksPath, managed);
  assert.equal(res.corruptPriorHooksPath, managed);
});

test('SessionStart emits one stderr line when the heal could not repair the config', async (t) => {
  const projectDir = await initRepo(t);
  const dataRoot = await tempDir(t, 'prior-report-data-');
  const managed = managedHooksDir(dataRoot, projectDir);
  await gitExec(projectDir, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(projectDir, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  t.after(() => { process.stderr.write = original; });

  const ctx = {
    input: {},
    env: { CLAUDE_PLUGIN_DATA: dataRoot, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
    projectDir,
    pluginRoot: REPO_ROOT,
    invokeCli: async () => ({ code: 0, stdout: '{}', stderr: '' }),
    invokeCliJson: async () => [],
  };
  await handleSessionStart(ctx);
  process.stderr.write = original;

  const lines = written.join('').trimEnd().split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `expected one report line, got: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /continuity\.priorHooksPath/);
});

test('a corrupt prior that only a global scope provides is neutralised for this repo', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const scopeDir = await tempDir(t, 'prior-report-scope-');
  const globalConfig = join(scopeDir, 'gitconfig-global');
  const systemConfig = join(scopeDir, 'gitconfig-system');
  await writeFile(globalConfig, `[continuity]\n\tpriorHooksPath = ${managed}\n`);
  await writeFile(systemConfig, '');
  const env = { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig };
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);

  const res = await install(repo, managed, env);

  assert.equal(res.priorHooksPathHeal, 'unrecoverable');
  assert.equal(await localConfig(repo, 'continuity.priorHooksPath'), '');
  assert.equal(await effectiveConfig(repo, env, 'continuity.priorHooksPath'), '');
});

test('a corrupt prior in worktree scope is unset so the local heal actually takes effect', async (t) => {
  const repo = await initRepo(t);
  const env = await scopes(t, null);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'extensions.worktreeConfig', 'true']);
  await gitExec(repo, ['config', '--worktree', 'continuity.priorHooksPath', managed]);

  const res = await install(repo, managed, env);

  assert.notEqual(res.priorHooksPathHeal, 'not-needed');
  const worktreeRead = await gitExec(repo, ['config', '--worktree', '--get', 'continuity.priorHooksPath'], { check: false });
  assert.notEqual(worktreeRead.code, 0, `worktree scope still carries the corrupt value: ${worktreeRead.stdout}`);
  assert.equal(await effectiveConfig(repo, env, 'continuity.priorHooksPath'), '');
});

test('a relative inherited hooks path is never healed into a working-tree exec target', async (t) => {
  const repo = await initRepo(t);
  const env = await scopes(t, '.githooks');
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const tracked = join(repo, '.githooks');
  const sentinel = join(repo, 'tracked-hooks-ran');
  await writeMarkerHook(tracked, 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const res = await install(repo, managed, env);

  assert.notEqual(res.priorHooksPath, '.githooks', 'a relative inherited value was stored raw');
  assert.equal(res.priorHooksPath, '');
  assert.equal(res.priorHooksPathHeal, 'unrecoverable');

  const commit = await commitOnce(repo, env, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), false, 'working-tree content became the hook exec target');
});

test('an absolute inherited hooks path outside the work tree is stored resolved', async (t) => {
  const repo = await initRepo(t);
  const inherited = await tempDir(t, 'prior-report-inherited-');
  const env = await scopes(t, join(inherited, '.', 'hooks'));
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const sentinel = join(repo, 'inherited-ran');
  await writeMarkerHook(join(inherited, 'hooks'), 'pre-commit', sentinel);
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const res = await install(repo, managed, env);

  assert.equal(res.priorHooksPathHeal, 'healed');
  assert.equal(res.priorHooksPath, join(inherited, 'hooks'));

  const commit = await commitOnce(repo, env, 'seed.txt');
  assert.equal(commit.code, 0, commit.stderr);
  assert.equal(await exists(sentinel), true, 'the inherited hook never ran');
});
