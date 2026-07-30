import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, copyFile, chmod, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitExec } from '../../../src/util/git-exec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const DISPATCHER = join(REPO_ROOT, 'hooks', 'dispatcher');

async function initRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dispatcher-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await gitExec(dir, ['init', '-q']);
  return dir;
}

async function stageAs(managedDir, hookName) {
  await mkdir(managedDir, { recursive: true });
  const dest = join(managedDir, hookName);
  await copyFile(DISPATCHER, dest);
  await chmod(dest, 0o755);
  return dest;
}

async function writePriorHook(priorDir, hookName, body) {
  await mkdir(priorDir, { recursive: true });
  const p = join(priorDir, hookName);
  await writeFile(p, body);
  await chmod(p, 0o755);
  return p;
}

function run(scriptPath, cwd, args = [], env = {}) {
  return spawnSync(scriptPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, ...env },
  });
}

test('dispatcher chains to the prior same-named hook', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const priorDir = join(repo, 'priorhooks');
  const marker = join(repo, 'marker.txt');
  await writePriorHook(priorDir, 'pre-commit', `#!/bin/sh\nprintf ran > "${marker}"\nexit 0\n`);
  await gitExec(repo, ['config', 'continuity.priorHooksPath', priorDir]);
  const script = await stageAs(managed, 'pre-commit');
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(await readFile(marker, 'utf8'), 'ran');
});

test('dispatcher fails open when the prior hook is absent', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const priorDir = join(repo, 'priorhooks');
  await mkdir(priorDir, { recursive: true });
  await gitExec(repo, ['config', 'continuity.priorHooksPath', priorDir]);
  const script = await stageAs(managed, 'pre-commit');
  const r = run(script, repo);
  assert.equal(r.status, 0);
});

test('dispatcher propagates a non-zero exit from the prior hook', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const priorDir = join(repo, 'priorhooks');
  await writePriorHook(priorDir, 'pre-commit', `#!/bin/sh\nexit 7\n`);
  await gitExec(repo, ['config', 'continuity.priorHooksPath', priorDir]);
  const script = await stageAs(managed, 'pre-commit');
  const r = run(script, repo);
  assert.equal(r.status, 7);
});

test('dispatcher guards against self-exec when the prior dir is the managed dir', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', managed]);
  const r = run(script, repo);
  assert.equal(r.status, 0);
});

test('dispatcher names the offending config key on stderr before the self-exec guard', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', managed]);
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  assert.match(r.stderr, /continuity\.priorHooksPath/);
  assert.match(r.stderr, /git config --get/);
  assert.ok(r.stderr.includes('managed'), `stderr did not name the offending dir: ${r.stderr}`);
  assert.equal(r.stdout, '');
});

test('dispatcher keeps the project path out of the reported line', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', managed]);
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.includes(repo), false, `stderr disclosed the project path: ${r.stderr}`);
});

test('dispatcher warns when the prior hooks path is set but resolves to nothing', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', join(repo, 'gone-hooks')]);
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  assert.match(r.stderr, /continuity\.priorHooksPath/);
  assert.match(r.stderr, /does not resolve/);
  assert.equal(r.stdout, '');
});

test('dispatcher stays silent on an unset prior hooks path with no default hooks dir', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  await rm(join(repo, '.git', 'hooks'), { recursive: true, force: true });
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('dispatcher stays silent on post-index-change when the prior hooks path is corrupt', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', managed]);
  const script = await stageAs(managed, 'post-index-change');
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '', `post-index-change reported on stderr: ${r.stderr}`);
});

test('dispatcher reports a skipped reference-transaction prior in the state that gates', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', managed]);
  const script = await stageAs(managed, 'reference-transaction');
  const r = run(script, repo, ['prepared']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  assert.match(r.stderr, /reference-transaction/);
  assert.match(r.stderr, /continuity\.priorHooksPath/);
});

test('dispatcher does not repeat the reference-transaction report in non-gating states', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', managed]);
  const script = await stageAs(managed, 'reference-transaction');
  for (const state of ['committed', 'aborted']) {
    const r = run(script, repo, [state]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '', `state ${state} reported on stderr: ${r.stderr}`);
  }
});

test('dispatcher caps the reported label so one hostile value cannot flood stderr', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', `/nowhere/${'z'.repeat(4000)}`]);
  const r = run(script, repo);
  assert.equal(r.status, 0);
  const line = r.stderr.trimEnd();
  assert.equal(line.split('\n').length, 1);
  assert.ok(line.length <= 320, `report line was ${line.length} chars: ${line.slice(0, 120)}`);
});

test('dispatcher reports one control-free line for a value carrying terminal escapes', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  const hostile = '/nowhere/[31mFORGED[0m\nsecond line';
  await gitExec(repo, ['config', 'continuity.priorHooksPath', hostile]);
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.includes(''), false, 'a terminal escape reached stderr');
  assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  assert.equal(r.stderr.includes('second line'), false, 'a second value line reached stderr');
});

test('dispatcher surfaces the recorded corrupt value once the prior key has been reset', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  await gitExec(repo, ['config', 'continuity.priorHooksPath', '']);
  await gitExec(repo, ['config', 'continuity.priorHooksPathCorrupt', managed]);
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  assert.match(r.stderr, /continuity\.priorHooksPathCorrupt/);
});

test('dispatcher stays silent when the prior hooks path is honest', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed');
  const priorDir = join(repo, 'priorhooks');
  await writePriorHook(priorDir, 'pre-commit', `#!/bin/sh\nexit 0\n`);
  await gitExec(repo, ['config', 'continuity.priorHooksPath', priorDir]);
  const script = await stageAs(managed, 'pre-commit');
  const r = run(script, repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('dispatcher fails open outside a git work tree', async (t) => {
  const nongit = await mkdtemp(join(tmpdir(), 'dispatcher-nongit-'));
  t.after(() => rm(nongit, { recursive: true, force: true }));
  const managed = join(nongit, 'managed');
  const script = await stageAs(managed, 'pre-commit');
  const r = run(script, nongit);
  assert.equal(r.status, 0);
});
