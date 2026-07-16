import test from 'node:test';
import assert from 'node:assert/strict';
import { reattach } from '../../../src/drift/reattach.mjs';
import { makeFakeDriver } from './fake-driver.mjs';

const THREAD_A = '0123456789ABCDEFGHJKMNPQRS';
const THREAD_B = '0123456789ABCDEFGHJKMNPQRT';
const NOW = '2026-07-15T12:00:00Z';

function activeThread(id) {
  return { id, status: 'active', completion_criteria: [] };
}

function terminalThread(id) {
  return { id, status: 'done', completion_criteria: [] };
}

test('reattach on a non-git driver returns unsupported', async () => {
  const { driver } = makeFakeDriver({ isGit: false });
  const result = await reattach(driver, { repo: 'acme/app', branch: 'feat/x' }, { now: NOW });
  assert.deepEqual(result, { matched: false, method: 'unsupported' });
});

test('reattach rejects an empty repo or branch', async () => {
  const { driver } = makeFakeDriver();
  await assert.rejects(() => reattach(driver, { repo: '', branch: 'feat/x' }, { now: NOW }), /repo/);
  await assert.rejects(() => reattach(driver, { repo: 'acme/app', branch: '  ' }, { now: NOW }), /branch/);
});

test('reattach fails loudly when the git driver lacks observeNewBranch', async () => {
  const driver = { isGit: () => true };
  await assert.rejects(
    () => reattach(driver, { repo: 'acme/app', branch: 'feat/x' }, { now: NOW }),
    /observeNewBranch/,
  );
});

test('reattach resolves via the trailer rung and writes a trailer-present binding', async () => {
  const { driver, calls } = makeFakeDriver({
    threads: { [THREAD_A]: activeThread(THREAD_A) },
    newBranchObservations: { 'acme/app feat/new': { thread_id_trailer: THREAD_A, first_commit: null } },
  });
  const result = await reattach(driver, { repo: 'acme/app', branch: 'feat/new' }, { now: NOW });
  assert.equal(result.matched, true);
  assert.equal(result.method, 'trailer');
  assert.equal(result.thread_id, THREAD_A);
  assert.equal(result.binding.thread_id, THREAD_A);
  assert.equal(result.binding.trailer_present, true);
  assert.equal(result.binding.created_at, NOW);
  assert.deepEqual(result.recommendation, { action: 'resume', thread_to: 'active', predecessor_id: null });
  assert.equal(calls.writeBinding.length, 1);
});

test('reattach resolves via the first-commit rung when there is no trailer', async () => {
  const { driver } = makeFakeDriver({
    threads: { [THREAD_A]: activeThread(THREAD_A) },
    bindings: [{ id: '0123456789ABCDEFGHJKMNPQRV', thread_id: THREAD_A, repo: 'acme/app', branch: 'feat/old', first_commit: 'sha-1' }],
    newBranchObservations: { 'acme/app feat/renamed': { thread_id_trailer: null, first_commit: 'sha-1' } },
  });
  const result = await reattach(driver, { repo: 'acme/app', branch: 'feat/renamed' }, { now: NOW });
  assert.equal(result.method, 'first-commit');
  assert.equal(result.thread_id, THREAD_A);
  assert.equal(result.binding.trailer_present, false);
  assert.equal(result.binding.first_commit, 'sha-1');
});

test('reattach resolves via the slug rung through the by-slug index', async () => {
  const { driver } = makeFakeDriver({
    threads: { [THREAD_A]: activeThread(THREAD_A) },
    bySlug: { 'fix-signup': THREAD_A },
    newBranchObservations: { 'acme/app fix/signup': { thread_id_trailer: null, first_commit: null } },
  });
  const result = await reattach(driver, { repo: 'acme/app', branch: 'fix/signup' }, { now: NOW });
  assert.equal(result.method, 'slug');
  assert.equal(result.thread_id, THREAD_A);
});

test('reattach returns manual and writes nothing when no rung resolves', async () => {
  const { driver, calls } = makeFakeDriver({
    newBranchObservations: { 'acme/app feat/orphan': { thread_id_trailer: null, first_commit: null } },
  });
  const result = await reattach(driver, { repo: 'acme/app', branch: 'feat/orphan' }, { now: NOW });
  assert.deepEqual(result, { matched: false, method: 'manual' });
  assert.equal(calls.writeBinding.length, 0);
});

test('reattach on a terminal thread writes no binding and offers a successor', async () => {
  const { driver, calls } = makeFakeDriver({
    threads: { [THREAD_A]: terminalThread(THREAD_A) },
    newBranchObservations: { 'acme/app feat/new': { thread_id_trailer: THREAD_A, first_commit: null } },
  });
  const result = await reattach(driver, { repo: 'acme/app', branch: 'feat/new' }, { now: NOW });
  assert.equal(result.matched, true);
  assert.equal(result.method, 'trailer');
  assert.equal(result.binding, null);
  assert.deepEqual(result.recommendation, { action: 'offer-successor', predecessor_id: THREAD_A, thread_to: null });
  assert.equal(calls.writeBinding.length, 0);
});

test('reattach obeys strict rung priority: trailer beats first-commit and slug', async () => {
  const { driver } = makeFakeDriver({
    threads: { [THREAD_A]: activeThread(THREAD_A), [THREAD_B]: activeThread(THREAD_B) },
    bindings: [{ id: '0123456789ABCDEFGHJKMNPQRV', thread_id: THREAD_B, repo: 'acme/app', branch: 'feat/old', first_commit: 'sha-1' }],
    bySlug: { 'feat-new': THREAD_B },
    newBranchObservations: { 'acme/app feat/new': { thread_id_trailer: THREAD_A, first_commit: 'sha-1' } },
  });
  const result = await reattach(driver, { repo: 'acme/app', branch: 'feat/new' }, { now: NOW });
  assert.equal(result.method, 'trailer');
  assert.equal(result.thread_id, THREAD_A);
});
