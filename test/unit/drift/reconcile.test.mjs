import test from 'node:test';
import assert from 'node:assert/strict';
import { runReconcile, closedBinding } from '../../../src/drift/reconcile.mjs';
import { makeFakeDriver } from './fake-driver.mjs';

const THREAD_A = '0123456789ABCDEFGHJKMNPQRS';
const BINDING_A = '0123456789ABCDEFGHJKMNPQRV';
const BINDING_B = '0123456789ABCDEFGHJKMNPQRW';
const NOW = '2026-07-15T12:00:00Z';

function activeBinding(id, branch) {
  return { id, thread_id: THREAD_A, repo: 'acme/app', branch, status: 'active', first_commit: 'abc123', closed_at: null, closed_reason: null };
}

function activeThread() {
  return { id: THREAD_A, status: 'active', completion_criteria: [] };
}

function healthy(overrides) {
  return {
    branch_exists: true,
    head_sha: 'def456',
    first_commit_present: true,
    merged: false,
    squash_merged: false,
    ahead: 0,
    behind: 0,
    force_push_detected: false,
    diverged_from_upstream: false,
    key_files_deleted: [],
    key_files_modified: [],
    ...overrides,
  };
}

function ctxFor(driver) {
  return { driver, projectDir: '/tmp/acme', userConfig: {}, now: () => NOW };
}

test('closedBinding returns a fresh closed record without mutating its input', () => {
  const binding = activeBinding(BINDING_A, 'feat/x');
  const closed = closedBinding(binding, 'orphaned', 'deleted', NOW);
  assert.deepEqual(closed, { ...binding, status: 'orphaned', closed_at: NOW, closed_reason: 'deleted' });
  assert.equal(binding.status, 'active');
});

test('closedBinding throws on a missing or blank nowIso', () => {
  const binding = activeBinding(BINDING_A, 'feat/x');
  assert.throws(() => closedBinding(binding, 'merged', 'merged', ''), /nowIso/);
  assert.throws(() => closedBinding(binding, 'merged', 'merged', undefined), /nowIso/);
});

test('runReconcile requires ctx.driver', async () => {
  await assert.rejects(() => runReconcile({}), /ctx.driver/);
});

test('runReconcile on a non-git driver short-circuits to an empty envelope', async () => {
  const { driver, calls } = makeFakeDriver({ isGit: false });
  const result = await runReconcile(ctxFor(driver));
  assert.deepEqual(result, { drift: [], dispositions: [] });
  assert.equal(calls.observeBranch.length, 0);
});

test('runReconcile fails loudly when the git driver lacks observeBranch/listRepoBranches', async () => {
  const driver = { isGit: () => true };
  await assert.rejects(() => runReconcile(ctxFor(driver)), /observeBranch/);
});

test('Phase 1 marks a deleted binding orphaned, writes the closed record, and never commits', async () => {
  const { driver, calls } = makeFakeDriver({
    bindings: [activeBinding(BINDING_A, 'feat/x')],
    threads: { [THREAD_A]: activeThread() },
    observations: { [BINDING_A]: healthy({ branch_exists: false }) },
    repoBranches: { 'acme/app': ['feat/x'] },
  });
  const result = await runReconcile(ctxFor(driver), { now: NOW });
  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].classification, 'WARNING');
  assert.equal(result.dispositions.length, 1);
  assert.equal(result.dispositions[0].action, 'mark-orphaned');
  assert.equal(calls.writeBinding.length, 1);
  assert.deepEqual(calls.writeBinding[0], {
    ...activeBinding(BINDING_A, 'feat/x'),
    status: 'orphaned',
    closed_at: NOW,
    closed_reason: 'deleted',
  });
  assert.equal(calls.commit, 0);
  assert.equal(calls.sync, 0);
});

test('Phase 1 skips a non-active binding without observing it', async () => {
  const { driver, calls } = makeFakeDriver({
    bindings: [{ ...activeBinding(BINDING_A, 'feat/x'), status: 'merged' }],
    threads: { [THREAD_A]: activeThread() },
    repoBranches: { 'acme/app': ['feat/x'] },
  });
  const result = await runReconcile(ctxFor(driver), { now: NOW });
  assert.deepEqual(result.drift, []);
  assert.equal(calls.observeBranch.length, 0);
});

test('Phase 1 leaves the binding untouched for a re-verify disposition', async () => {
  const { driver, calls } = makeFakeDriver({
    bindings: [activeBinding(BINDING_A, 'feat/x')],
    threads: { [THREAD_A]: activeThread() },
    observations: { [BINDING_A]: healthy({ ahead: 1, behind: 2 }) },
    repoBranches: { 'acme/app': ['feat/x'] },
  });
  const result = await runReconcile(ctxFor(driver), { now: NOW });
  assert.equal(result.dispositions[0].action, 're-verify');
  assert.equal(result.dispositions[0].binding_status, null);
  assert.equal(calls.writeBinding.length, 0);
});

test('Phase 1 skips a clean binding that produces no drift entry', async () => {
  const { driver } = makeFakeDriver({
    bindings: [activeBinding(BINDING_A, 'feat/x')],
    threads: { [THREAD_A]: activeThread() },
    observations: { [BINDING_A]: healthy() },
    repoBranches: { 'acme/app': ['feat/x'] },
  });
  const result = await runReconcile(ctxFor(driver), { now: NOW });
  assert.deepEqual(result.drift, []);
  assert.deepEqual(result.dispositions, []);
});

test('Phase 2 re-attaches an unbound branch and appends a reattach disposition', async () => {
  const { driver } = makeFakeDriver({
    bindings: [{ ...activeBinding(BINDING_B, 'feat/existing'), status: 'merged' }],
    threads: { [THREAD_A]: activeThread() },
    repoBranches: { 'acme/app': ['feat/existing', 'feat/new'] },
    newBranchObservations: { 'acme/app feat/new': { thread_id_trailer: THREAD_A, first_commit: null } },
  });
  const result = await runReconcile(ctxFor(driver), { now: NOW });
  const reattachDisps = result.dispositions.filter((d) => d.kind === 'reattach');
  assert.equal(reattachDisps.length, 1);
  assert.deepEqual(reattachDisps[0], { kind: 'reattach', thread_id: THREAD_A, branch: 'feat/new', repo: 'acme/app', method: 'trailer' });
});

test('Phase 2 leaves an unmatched (manual) branch alone', async () => {
  const { driver } = makeFakeDriver({
    bindings: [{ ...activeBinding(BINDING_B, 'feat/existing'), status: 'merged' }],
    threads: { [THREAD_A]: activeThread() },
    repoBranches: { 'acme/app': ['feat/existing', 'feat/unknown'] },
    newBranchObservations: { 'acme/app feat/unknown': { thread_id_trailer: null, first_commit: null } },
  });
  const result = await runReconcile(ctxFor(driver), { now: NOW });
  assert.equal(result.dispositions.filter((d) => d.kind === 'reattach').length, 0);
});

test('runReconcile falls back to the ctx.now function when opts.now is absent', async () => {
  const { driver, calls } = makeFakeDriver({
    bindings: [activeBinding(BINDING_A, 'feat/x')],
    threads: { [THREAD_A]: activeThread() },
    observations: { [BINDING_A]: healthy({ branch_exists: false }) },
    repoBranches: { 'acme/app': ['feat/x'] },
  });
  await runReconcile(ctxFor(driver));
  assert.equal(calls.writeBinding[0].closed_at, NOW);
});
