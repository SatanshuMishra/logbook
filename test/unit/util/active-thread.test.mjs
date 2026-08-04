import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { newUlid } from '../../../src/util/ulid.mjs';
import { projectKey } from '../../../src/util/project-key.mjs';
import {
  activeThreadPath,
  writeActiveThread,
  readActiveThread,
  clearActiveThread,
  writeActiveThreadOrWarn,
  readActiveThreadOrWarn,
  clearActiveThreadOrWarn,
} from '../../../src/util/active-thread.mjs';

function gitCtx(projectDir) {
  return { driver: { isGit: () => true }, projectDir, userConfig: {}, now: () => '2026-07-14T00:00:00Z' };
}

function localCtx(projectDir) {
  return { driver: { isGit: () => false }, projectDir, userConfig: {}, now: () => '2026-07-14T00:00:00Z' };
}

async function initRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'active-thread-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await gitExec(dir, ['init', '-q']);
  return dir;
}

test('git activeThreadPath resolves under the git-common-dir', async (t) => {
  const dir = await initRepo(t);
  const path = await activeThreadPath(gitCtx(dir));
  assert.equal(path, resolve(dir, '.git', 'ledger', 'active-thread'));
});

test('git activeThreadPath resolves the project repo despite an ambient GIT_DIR', async (t) => {
  const dir = await initRepo(t);
  const foreign = await initRepo(t);
  const priorDir = process.env.GIT_DIR;
  const priorWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = join(foreign, '.git');
  process.env.GIT_WORK_TREE = foreign;
  t.after(() => {
    if (priorDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorDir;
    if (priorWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = priorWorkTree;
  });
  const path = await activeThreadPath(gitCtx(dir));
  assert.equal(path, resolve(dir, '.git', 'ledger', 'active-thread'));
});

test('git write/read/clear round-trip', async (t) => {
  const dir = await initRepo(t);
  const ctx = gitCtx(dir);
  const id = newUlid();
  assert.equal(await readActiveThread(ctx), null);
  const target = await writeActiveThread(ctx, id);
  assert.equal((await readFile(target, 'utf8')), `${id}\n`);
  assert.equal(await readActiveThread(ctx), id);
  await clearActiveThread(ctx);
  assert.equal(await readActiveThread(ctx), null);
});

test('writeActiveThread rejects a non-ULID threadId', async (t) => {
  const dir = await initRepo(t);
  await assert.rejects(() => writeActiveThread(gitCtx(dir), 'not-a-ulid'), /ULID/);
});

test('non-git activeThreadPath uses CLAUDE_PLUGIN_DATA and project-key', async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'active-thread-data-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const prior = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dataRoot;
  t.after(() => {
    if (prior === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prior;
  });
  const projectDir = '/Users/someone/projects/demo';
  const ctx = localCtx(projectDir);
  const path = await activeThreadPath(ctx);
  assert.equal(path, join(dataRoot, projectKey(projectDir), 'active-thread'));
  const id = newUlid();
  await writeActiveThread(ctx, id);
  assert.equal(await readActiveThread(ctx), id);
  await clearActiveThread(ctx);
  assert.equal(await readActiveThread(ctx), null);
});

test('non-git activeThreadPath throws when CLAUDE_PLUGIN_DATA is unset', async (t) => {
  const prior = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  t.after(() => {
    if (prior !== undefined) process.env.CLAUDE_PLUGIN_DATA = prior;
  });
  await assert.rejects(() => activeThreadPath(localCtx('/abs/dir')), /CLAUDE_PLUGIN_DATA/);
});

test('activeThreadPath requires a driver with isGit', async () => {
  await assert.rejects(() => activeThreadPath({ projectDir: '/abs' }), /isGit/);
});

async function occupyPointerDir(t) {
  const dir = await initRepo(t);
  const ctx = gitCtx(dir);
  await writeFile(join(dir, '.git', 'ledger'), 'occupied\n');
  return ctx;
}

test('writeActiveThreadOrWarn warns instead of throwing when the pointer dir is a file', async (t) => {
  const ctx = await occupyPointerDir(t);
  const { warning } = await writeActiveThreadOrWarn(ctx, newUlid());
  assert.match(warning, /ENOTDIR|EEXIST/);
  assert.match(warning, /debrief/);
});

test('readActiveThreadOrWarn and clearActiveThreadOrWarn warn on the same condition', async (t) => {
  const ctx = await occupyPointerDir(t);
  const read = await readActiveThreadOrWarn(ctx);
  assert.equal(read.value, null);
  assert.match(read.warning, /ENOTDIR|EEXIST/);
  const cleared = await clearActiveThreadOrWarn(ctx);
  assert.match(cleared.warning, /ENOTDIR|EEXIST/);
});

test('the tolerant wrappers still propagate a programming error', async (t) => {
  const dir = await initRepo(t);
  await assert.rejects(() => writeActiveThreadOrWarn(gitCtx(dir), 'not-a-ulid'), /ULID/);
  await assert.rejects(() => readActiveThreadOrWarn({ projectDir: '/abs' }), /isGit/);
});
