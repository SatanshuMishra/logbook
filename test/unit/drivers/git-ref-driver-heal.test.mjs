import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initGitRepo, makeGitDriver, makeTempDir } from '../../fixtures/git-repos.mjs';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { GitRefDriver, WORKTREE_LOCK_FILE, WORKTREE_LOCK_TIMEOUT_MS } from '../../../src/drivers/git-ref-driver.mjs';
import { LocalDriver } from '../../../src/drivers/local-driver.mjs';

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_B = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

function makeThread(overrides = {}) {
  return {
    schema_version: 1,
    id: ULID_A,
    slug: 'my-thread',
    title: 'My Thread',
    status: 'active',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [{ text: 'ship it', done: false }],
    vcs_ref: null,
    external_refs: [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      status: 'active',
      active_goal: 'g',
      next_step: 'n',
      open_risks: [],
      key_decisions: [],
      out_of_scope: [],
    },
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
    ...overrides,
  };
}

async function adminDirOf(worktreeDir) {
  const pointer = await readFile(join(worktreeDir, '.git'), 'utf8');
  return pointer.trim().replace(/^gitdir:\s*/, '');
}

async function danglePointer(worktreeDir) {
  await rm(await adminDirOf(worktreeDir), { recursive: true, force: true });
}

async function reprovisionUnderANewAdminId(t, repo, driver) {
  const decoy = join(await makeTempDir(t, 'git-driver-decoy-'), 'ledger-worktree');
  await rm(driver.worktreeDir, { recursive: true, force: true });
  await gitExec(repo, ['worktree', 'prune']);
  await gitExec(repo, ['worktree', 'add', '--detach', decoy, driver.ledgerRef]);
  await gitExec(repo, ['worktree', 'add', '--detach', driver.worktreeDir, driver.ledgerRef]);
  return decoy;
}

async function refFileNames(repo, ref) {
  const { stdout } = await gitExec(repo, ['ls-tree', '-r', '--name-only', ref]);
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

test('a dangling worktree pointer heals before the write, and the write reaches the ledger ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.commit('chore(ledger): thread');

  await danglePointer(driver.worktreeDir);

  await driver.appendSessionEvent(ULID_A, '2026-08-03T10:00:00Z', 'agent', 'session body\n');
  const result = await driver.commit('chore(ledger): session event');

  assert.equal(result.committed, true);
  const names = await refFileNames(repo, driver.ledgerRef);
  assert.ok(names.some((name) => name.startsWith(`sessions/${ULID_A}/`)), names.join(','));
});

test('healing a dangling worktree pointer keeps records already committed to the ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.commit('chore(ledger): first thread');

  await danglePointer(driver.worktreeDir);

  await driver.writeThread(makeThread({ id: ULID_B, slug: 'second-thread' }));
  await driver.commit('chore(ledger): second thread');

  const names = await refFileNames(repo, driver.ledgerRef);
  assert.ok(names.includes(`threads/${ULID_A}.json`), names.join(','));
  assert.ok(names.includes(`threads/${ULID_B}.json`), names.join(','));
  assert.equal((await driver.readThread(ULID_A)).slug, 'my-thread');
});

test('a worktree re-provisioned under a new admin id does not wedge a live driver', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.commit('chore(ledger): thread');

  const decoy = await reprovisionUnderANewAdminId(t, repo, driver);
  const decoyHeadBefore = (await gitExec(decoy, ['rev-parse', 'HEAD'])).stdout.trim();

  await driver.writeThread(makeThread({ id: ULID_B, slug: 'second-thread' }));
  const result = await driver.commit('chore(ledger): second thread');

  assert.equal(result.committed, true);
  const names = await refFileNames(repo, driver.ledgerRef);
  assert.ok(names.includes(`threads/${ULID_B}.json`), names.join(','));
  const worktreeHead = (await gitExec(driver.worktreeDir, ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal(worktreeHead, result.sha);
  assert.equal((await gitExec(decoy, ['rev-parse', 'HEAD'])).stdout.trim(), decoyHeadBefore);
});

test('a pointer that breaks after a write surfaces the failure and keeps the in-flight file', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();

  const path = await driver.appendSessionEvent(ULID_A, '2026-08-03T10:00:00Z', 'agent', 'in flight\n');
  await danglePointer(driver.worktreeDir);

  await assert.rejects(() => driver.commit('chore(ledger): session event'));
  assert.equal(existsSync(path), true);
  assert.equal(await readFile(path, 'utf8'), 'in flight\n');
});

async function plantLock(repo, contents, ageMs) {
  const lockPath = join(repo, '.git', WORKTREE_LOCK_FILE);
  await writeFile(lockPath, contents);
  const when = new Date(Date.now() - ageMs);
  await utimes(lockPath, when, when);
  return lockPath;
}

test('provisioning releases its lock file', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  assert.equal(existsSync(join(repo, '.git', WORKTREE_LOCK_FILE)), false);
});

test('a lock left behind by a dead holder is broken instead of wedging provisioning', async (t) => {
  const repo = await initGitRepo(t);
  const lockPath = await plantLock(repo, 'dead-holder', WORKTREE_LOCK_TIMEOUT_MS * 2);
  const driver = await makeGitDriver(t, repo);

  const started = Date.now();
  await driver.init();

  assert.ok(Date.now() - started < WORKTREE_LOCK_TIMEOUT_MS);
  assert.equal(existsSync(lockPath), false);
});

test('a lock still held on entry is waited on, then broken once it ages out of the budget', async (t) => {
  const repo = await initGitRepo(t);
  const lockPath = await plantLock(repo, 'slow-holder', WORKTREE_LOCK_TIMEOUT_MS - 400);
  const driver = await makeGitDriver(t, repo);

  const started = Date.now();
  await driver.init();
  const elapsed = Date.now() - started;

  assert.ok(elapsed >= 300, `elapsed ${elapsed}`);
  assert.ok(elapsed < WORKTREE_LOCK_TIMEOUT_MS, `elapsed ${elapsed}`);
  assert.equal(existsSync(lockPath), false);
  assert.equal(existsSync(join(driver.worktreeDir, '.gitattributes')), true);
});

test('every LocalDriver write-ish method has a GitRefDriver override that routes it through the heal', () => {
  const overridden = new Set(Object.getOwnPropertyNames(GitRefDriver.prototype));
  const writeMethods = Object.getOwnPropertyNames(LocalDriver.prototype)
    .filter((name) => /^(write|append)/.test(name));
  assert.ok(writeMethods.length > 0);
  for (const name of writeMethods) {
    assert.ok(
      overridden.has(name),
      `LocalDriver.prototype.${name} has no GitRefDriver override — route it through #writeInWorktree`,
    );
  }
});
