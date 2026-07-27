import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';
import {
  hostScope,
  isolatedScope,
  networkScope,
  pinnedScope,
  resolveGitDir,
  scopedExec,
} from '../../../src/util/git-scope.mjs';

async function scratchDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'git-scope-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function initRepo(t) {
  const dir = await scratchDir(t);
  await gitExec(dir, ['init', '-q']);
  return dir;
}

test('hostScope clears the ambient location variables without pinning', () => {
  const scope = hostScope('/abs/repo');
  assert.equal(scope.dir, '/abs/repo');
  assert.equal(scope.gitDir, null);
  assert.deepEqual(scope.args, []);
  assert.equal(scope.env.GIT_DIR, undefined);
  assert.ok('GIT_DIR' in scope.env);
  assert.ok('GIT_WORK_TREE' in scope.env);
});

test('pinnedScope pins GIT_DIR and adds no config overrides', () => {
  const scope = pinnedScope('/abs/repo', '/abs/repo/.git');
  assert.equal(scope.env.GIT_DIR, '/abs/repo/.git');
  assert.equal(scope.env.GIT_CONFIG_GLOBAL, undefined);
  assert.deepEqual(scope.args, []);
});

test('networkScope disables hooks and fsmonitor while keeping user config readable', () => {
  const scope = networkScope('/abs/repo', '/abs/repo/.git');
  assert.deepEqual(scope.args, [
    '-c', 'core.hooksPath=/abs/repo/.git/hooks-disabled',
    '-c', 'core.fsmonitor=false',
  ]);
  assert.equal(scope.env.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(scope.env.GIT_CONFIG_NOSYSTEM, undefined);
});

test('isolatedScope nulls global config and re-injects safe.directory for its target', () => {
  const repo = isolatedScope('/abs/repo', '/abs/repo/.git');
  const worktree = isolatedScope('/abs/wt', '/abs/repo/.git/worktrees/wt');
  assert.equal(repo.env.GIT_CONFIG_GLOBAL, devNull);
  assert.equal(repo.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(repo.env.GIT_CONFIG_COUNT, '0');
  assert.ok(repo.args.includes('-c'));
  assert.ok(repo.args.includes('safe.directory=/abs/repo'));
  assert.ok(worktree.args.includes('safe.directory=/abs/wt'));
  assert.ok(repo.args.includes('core.hooksPath=/abs/repo/.git/hooks-disabled'));
});

test('resolveGitDir returns the absolute git dir of the directory it is given', async (t) => {
  const repo = await initRepo(t);
  const gitDir = await resolveGitDir(repo);
  assert.equal(gitDir.endsWith('/.git'), true);
  const { stdout } = await gitExec(repo, ['rev-parse', '--absolute-git-dir']);
  assert.equal(gitDir, stdout.trim());
});

test('resolveGitDir reports the directory that could not be resolved', async (t) => {
  const plain = await scratchDir(t);
  await assert.rejects(
    () => resolveGitDir(plain),
    (error) => error.message.startsWith('resolveGitDir:') && error.message.includes(plain),
  );
});

test('resolveGitDir reports a directory git cannot even be run in', async (t) => {
  const plain = await scratchDir(t);
  await assert.rejects(
    () => resolveGitDir(join(plain, 'missing')),
    (error) => error.message.startsWith('resolveGitDir:') && error.message.includes('missing'),
  );
});

test('scopedExec prefixes the scope arguments ahead of the subcommand', async (t) => {
  const repo = await initRepo(t);
  const scope = isolatedScope(repo, await resolveGitDir(repo));
  const { code, stdout } = await scopedExec(scope, ['config', '--get', 'core.hooksPath'], { check: false });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), join(scope.gitDir, 'hooks-disabled'));
});

test('scopedExec rejects a malformed scope', async () => {
  await assert.rejects(() => scopedExec(null, ['status']), /scope must carry/);
  await assert.rejects(() => scopedExec(hostScope('/abs'), 'status'), /args must be an array/);
});
