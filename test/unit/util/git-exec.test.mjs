import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';

async function initRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'git-exec-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await gitExec(dir, ['init', '-q']);
  return dir;
}

test('gitExec runs a command and returns trimmed-able stdout', async (t) => {
  const dir = await initRepo(t);
  const { code, stdout } = await gitExec(dir, ['rev-parse', '--is-inside-work-tree']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), 'true');
});

test('gitExec merges the {env} over process.env for author/committer identity', async (t) => {
  const dir = await initRepo(t);
  await writeFile(join(dir, 'f.txt'), 'hi');
  await gitExec(dir, ['add', 'f.txt']);
  await gitExec(dir, ['commit', '-m', 'x'], {
    env: {
      GIT_AUTHOR_NAME: 'Env Author',
      GIT_AUTHOR_EMAIL: 'env@author.test',
      GIT_COMMITTER_NAME: 'Env Author',
      GIT_COMMITTER_EMAIL: 'env@author.test',
    },
  });
  const { stdout } = await gitExec(dir, ['log', '-1', '--format=%an|%ae']);
  assert.equal(stdout.trim(), 'Env Author|env@author.test');
});

test('gitExec throws on a non-zero exit by default (check:true)', async (t) => {
  const dir = await initRepo(t);
  await assert.rejects(
    () => gitExec(dir, ['rev-parse', '--verify', 'refs/heads/nope']),
    (err) => {
      assert.ok(err instanceof Error);
      assert.notEqual(err.code, 0);
      return true;
    },
  );
});

test('gitExec resolves with the exit code when check:false', async (t) => {
  const dir = await initRepo(t);
  const { code } = await gitExec(dir, ['rev-parse', '--verify', 'refs/heads/nope'], { check: false });
  assert.notEqual(code, 0);
});

test('gitExec rejects a non-array args', async () => {
  await assert.rejects(() => gitExec('/tmp', 'status'), /array/);
});
