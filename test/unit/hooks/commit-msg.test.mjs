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
const COMMIT_MSG = join(REPO_ROOT, 'hooks', 'commit-msg');
const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_B = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

async function initRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'commit-msg-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await gitExec(dir, ['init', '-q']);
  return dir;
}

async function stageCommitMsg(managedDir) {
  await mkdir(managedDir, { recursive: true });
  const dest = join(managedDir, 'commit-msg');
  await copyFile(COMMIT_MSG, dest);
  await chmod(dest, 0o755);
  return dest;
}

async function writePointer(repo, id) {
  const p = join(repo, '.git', 'ledger', 'active-thread');
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, `${id}\n`);
}

async function writeMsg(repo, body) {
  const p = join(repo, 'COMMIT_EDITMSG');
  await writeFile(p, body);
  return p;
}

function run(script, cwd, msgFile, env = {}) {
  return spawnSync(script, [msgFile], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, ...env },
  });
}

function trailerCount(text) {
  return text.split(/\r?\n/).filter((l) => l.startsWith('Thread-Id:')).length;
}

test('commit-msg inserts the Thread-Id trailer from the active-thread pointer', async (t) => {
  const repo = await initRepo(t);
  await writePointer(repo, ULID_A);
  const script = await stageCommitMsg(join(repo, 'managed'));
  const msg = await writeMsg(repo, 'add feature\n\nbody\n');
  const r = run(script, repo, msg);
  assert.equal(r.status, 0);
  assert.match(await readFile(msg, 'utf8'), new RegExp(`^Thread-Id: ${ULID_A}$`, 'm'));
});

test('commit-msg prefers LEDGER_THREAD_ID over the pointer', async (t) => {
  const repo = await initRepo(t);
  await writePointer(repo, ULID_A);
  const script = await stageCommitMsg(join(repo, 'managed'));
  const msg = await writeMsg(repo, 'subject\n');
  const r = run(script, repo, msg, { LEDGER_THREAD_ID: ULID_B });
  assert.equal(r.status, 0);
  const out = await readFile(msg, 'utf8');
  assert.match(out, new RegExp(`^Thread-Id: ${ULID_B}$`, 'm'));
  assert.doesNotMatch(out, new RegExp(ULID_A));
});

test('commit-msg is idempotent (no duplicate trailer on re-run)', async (t) => {
  const repo = await initRepo(t);
  await writePointer(repo, ULID_A);
  const script = await stageCommitMsg(join(repo, 'managed'));
  const msg = await writeMsg(repo, 'subject\n\nbody\n');
  run(script, repo, msg);
  run(script, repo, msg);
  assert.equal(trailerCount(await readFile(msg, 'utf8')), 1);
});

test('commit-msg no-ops when continuity.trailer=false', async (t) => {
  const repo = await initRepo(t);
  await writePointer(repo, ULID_A);
  await gitExec(repo, ['config', 'continuity.trailer', 'false']);
  const script = await stageCommitMsg(join(repo, 'managed'));
  const msg = await writeMsg(repo, 'subject\n');
  const r = run(script, repo, msg);
  assert.equal(r.status, 0);
  assert.equal(trailerCount(await readFile(msg, 'utf8')), 0);
});

test('commit-msg no-ops when neither env nor pointer resolves an id', async (t) => {
  const repo = await initRepo(t);
  const script = await stageCommitMsg(join(repo, 'managed'));
  const msg = await writeMsg(repo, 'subject\n');
  const r = run(script, repo, msg);
  assert.equal(r.status, 0);
  assert.equal(trailerCount(await readFile(msg, 'utf8')), 0);
});

test('commit-msg rejects a non-ULID pointer value', async (t) => {
  const repo = await initRepo(t);
  await writePointer(repo, 'not-a-valid-ulid-string');
  const script = await stageCommitMsg(join(repo, 'managed'));
  const msg = await writeMsg(repo, 'subject\n');
  const r = run(script, repo, msg);
  assert.equal(r.status, 0);
  assert.equal(trailerCount(await readFile(msg, 'utf8')), 0);
});

test('commit-msg chains to a prior commit-msg and still inserts the trailer', async (t) => {
  const repo = await initRepo(t);
  await writePointer(repo, ULID_A);
  const priorDir = join(repo, 'priorhooks');
  await mkdir(priorDir, { recursive: true });
  const marker = join(repo, 'prior-ran.txt');
  await writeFile(join(priorDir, 'commit-msg'), `#!/bin/sh\nprintf ran > "${marker}"\nexit 0\n`);
  await chmod(join(priorDir, 'commit-msg'), 0o755);
  await gitExec(repo, ['config', 'continuity.priorHooksPath', priorDir]);
  const script = await stageCommitMsg(join(repo, 'managed'));
  const msg = await writeMsg(repo, 'subject\n');
  const r = run(script, repo, msg);
  assert.equal(r.status, 0);
  assert.equal(await readFile(marker, 'utf8'), 'ran');
  assert.match(await readFile(msg, 'utf8'), new RegExp(`^Thread-Id: ${ULID_A}$`, 'm'));
});
