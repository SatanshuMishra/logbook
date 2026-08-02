import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { installCommitMsgHook } from '../../../hooks/lib/installer.mjs';
import { withGitEnv } from '../../fixtures/git-repos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const SOURCE_HOOK = join(REPO_ROOT, 'hooks', 'commit-msg');
const REFUSED_REF = 'refs/heads/protected';

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function scopes(t) {
  const dir = await tempDir(t, 'ref-txn-scope-');
  const globalConfig = join(dir, 'gitconfig-global');
  const systemConfig = join(dir, 'gitconfig-system');
  await writeFile(globalConfig, '');
  await writeFile(systemConfig, '');
  return { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: systemConfig };
}

async function refusingHooksDir(t) {
  const dir = await tempDir(t, 'ref-txn-prior-');
  const hook = join(dir, 'reference-transaction');
  await writeFile(
    hook,
    `#!/bin/sh\nwhile read -r old new ref; do\n  case "$ref" in ${REFUSED_REF}) echo "refusing $ref" >&2; exit 1 ;; esac\ndone\nexit 0\n`,
  );
  await chmod(hook, 0o755);
  return dir;
}

async function seededRepo(t, env) {
  const dir = await tempDir(t, 'ref-txn-');
  await gitExec(dir, ['init', '-q', '-b', 'main']);
  await gitExec(dir, ['config', '--local', 'user.name', 'Test User']);
  await gitExec(dir, ['config', '--local', 'user.email', 'test@example.com']);
  await writeFile(join(dir, 'a.txt'), 'a\n');
  await gitExec(dir, ['add', 'a.txt'], { env });
  await gitExec(dir, ['commit', '-q', '--no-verify', '-m', 'chore: seed'], { env });
  await gitExec(dir, ['branch', 'protected'], { env });
  await writeFile(join(dir, 'b.txt'), 'b\n');
  await gitExec(dir, ['add', 'b.txt'], { env });
  await gitExec(dir, ['commit', '-q', '--no-verify', '-m', 'chore: advance'], { env });
  return dir;
}

async function revision(repo, env, ref) {
  const { stdout } = await gitExec(repo, ['rev-parse', ref], { env });
  return stdout.trim();
}

async function installOver(repo, managed, env, priorDir) {
  await gitExec(repo, ['config', '--local', 'core.hooksPath', priorDir]);
  return withGitEnv(
    env,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
}

test('a chained reference-transaction prior still aborts the ref update it refuses', async (t) => {
  const env = await scopes(t);
  const repo = await seededRepo(t, env);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const prior = await refusingHooksDir(t);
  await installOver(repo, managed, env, prior);
  const before = await revision(repo, env, 'protected');

  const moved = await gitExec(repo, ['branch', '-f', 'protected', 'main'], { check: false, env });

  assert.notEqual(moved.code, 0, 'the refusing prior hook no longer gates the ref update');
  assert.equal(await revision(repo, env, 'protected'), before, 'the refused ref moved anyway');
});

test('a reference-transaction prior that cannot run is reported on the ref update it no longer gates', async (t) => {
  const env = await scopes(t);
  const repo = await seededRepo(t, env);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const prior = await refusingHooksDir(t);
  await installOver(repo, managed, env, prior);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', managed]);

  const moved = await gitExec(repo, ['branch', '-f', 'protected', 'main'], { check: false, env });

  assert.equal(moved.code, 0, moved.stderr);
  const reported = moved.stderr.trimEnd().split('\n').filter((l) => l.startsWith('continuity:'));
  assert.equal(reported.length, 1, `expected one report, got: ${moved.stderr}`);
  assert.match(reported[0], /reference-transaction/);
});

test('a dangling reference-transaction prior is reported rather than passing silently', async (t) => {
  const env = await scopes(t);
  const repo = await seededRepo(t, env);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const prior = await refusingHooksDir(t);
  await installOver(repo, managed, env, prior);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', join(repo, 'gone-hooks')]);

  const moved = await gitExec(repo, ['branch', '-f', 'protected', 'main'], { check: false, env });

  assert.equal(moved.code, 0, moved.stderr);
  const reported = moved.stderr.trimEnd().split('\n').filter((l) => l.startsWith('continuity:'));
  assert.equal(reported.length, 1, `expected one report, got: ${moved.stderr}`);
  assert.match(reported[0], /does not resolve/);
});

test('an installed managed chain leaves an unrelated ref update silent', async (t) => {
  const env = await scopes(t);
  const repo = await seededRepo(t, env);
  const managed = join(repo, 'data', 'main-key', 'githooks');
  const prior = await refusingHooksDir(t);
  await installOver(repo, managed, env, prior);
  await mkdir(join(repo, 'unrelated'), { recursive: true });

  const moved = await gitExec(repo, ['branch', '-f', 'sidebranch', 'main'], { check: false, env });

  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(moved.stderr.includes('continuity:'), false, moved.stderr);
});
