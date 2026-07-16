import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservation, CLASSIFICATION_RANK } from '../../../src/drift/classification.mjs';

const BINDING = Object.freeze({
  id: '0123456789ABCDEFGHJKMNPQRV',
  thread_id: '0123456789ABCDEFGHJKMNPQRS',
  repo: 'acme/app',
  branch: 'feat/x',
  first_commit: 'abc123',
});

function healthy() {
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
  };
}

function codes(entry) {
  return entry.signals.map((s) => s.code);
}

function signal(entry, code) {
  return entry.signals.find((s) => s.code === code);
}

test('CLASSIFICATION_RANK ranks CRITICAL > WARNING > COMPLETE', () => {
  assert.deepEqual({ ...CLASSIFICATION_RANK }, { CRITICAL: 3, WARNING: 2, COMPLETE: 1 });
});

test('a healthy observation fires no signal and returns null', () => {
  assert.equal(classifyObservation(BINDING, healthy()), null);
});

test('head-missing fires CRITICAL only on a live branch with a missing anchor', () => {
  const entry = classifyObservation(BINDING, { ...healthy(), first_commit_present: false });
  assert.equal(entry.classification, 'CRITICAL');
  const s = signal(entry, 'head-missing');
  assert.equal(s.classification, 'CRITICAL');
  assert.equal(s.detail, 'abc123');
});

test('key-file-deleted fires CRITICAL with a joined path detail', () => {
  const entry = classifyObservation(BINDING, {
    ...healthy(),
    key_files_deleted: ['ledger/a', 'ledger/b'],
  });
  assert.equal(signal(entry, 'key-file-deleted').classification, 'CRITICAL');
  assert.equal(signal(entry, 'key-file-deleted').detail, 'ledger/a, ledger/b');
  assert.equal(entry.classification, 'CRITICAL');
});

test('not-ancestor fires WARNING only when the branch still exists and diverged', () => {
  const entry = classifyObservation(BINDING, { ...healthy(), diverged_from_upstream: true });
  assert.equal(signal(entry, 'not-ancestor').classification, 'WARNING');
  const gone = classifyObservation(BINDING, {
    ...healthy(),
    branch_exists: false,
    diverged_from_upstream: true,
  });
  assert.equal(signal(gone, 'not-ancestor'), undefined);
});

test('divergence fires WARNING with the exact ahead/behind detail', () => {
  const entry = classifyObservation(BINDING, { ...healthy(), ahead: 2, behind: 3 });
  assert.equal(signal(entry, 'divergence').classification, 'WARNING');
  assert.equal(signal(entry, 'divergence').detail, 'ahead 2, behind 3');
});

test('key-file-modified fires WARNING with a joined path detail', () => {
  const entry = classifyObservation(BINDING, { ...healthy(), key_files_modified: ['ledger/c'] });
  assert.equal(signal(entry, 'key-file-modified').classification, 'WARNING');
  assert.equal(signal(entry, 'key-file-modified').detail, 'ledger/c');
});

test('a merged-but-present branch fires branch-gone(merged) COMPLETE', () => {
  const entry = classifyObservation(BINDING, { ...healthy(), merged: true });
  const s = signal(entry, 'branch-gone');
  assert.equal(s.classification, 'COMPLETE');
  assert.equal(s.detail, 'merged');
  assert.equal(entry.classification, 'COMPLETE');
});

test('a deleted-incomplete branch is branch-gone(deleted) WARNING, never CRITICAL', () => {
  const entry = classifyObservation(BINDING, { ...healthy(), branch_exists: false });
  const s = signal(entry, 'branch-gone');
  assert.equal(s.classification, 'WARNING');
  assert.equal(s.detail, 'deleted');
  assert.equal(entry.classification, 'WARNING');
});

test('a merged-then-pruned branch reports branch-gone(merged) COMPLETE (durability headline)', () => {
  const entry = classifyObservation(BINDING, {
    ...healthy(),
    branch_exists: false,
    merged: true,
  });
  assert.equal(signal(entry, 'branch-gone').detail, 'merged');
  assert.equal(entry.classification, 'COMPLETE');
});

test('a genuine squash-merge fires squash-merged(COMPLETE) but the entry-max is WARNING', () => {
  const entry = classifyObservation(BINDING, {
    ...healthy(),
    squash_merged: true,
    key_files_modified: ['src/a'],
  });
  assert.equal(signal(entry, 'squash-merged').classification, 'COMPLETE');
  assert.equal(signal(entry, 'branch-gone').detail, 'merged');
  assert.equal(entry.classification, 'WARNING');
  assert.ok(codes(entry).includes('squash-merged'));
});

test('multiple signals fire in fixed order and the entry classification is the max', () => {
  const entry = classifyObservation(BINDING, {
    ...healthy(),
    first_commit_present: false,
    ahead: 1,
  });
  assert.deepEqual(codes(entry), ['head-missing', 'divergence']);
  assert.equal(entry.classification, 'CRITICAL');
});

test('classifyObservation carries the binding identity onto the entry', () => {
  const entry = classifyObservation(BINDING, { ...healthy(), branch_exists: false });
  assert.equal(entry.binding_id, BINDING.id);
  assert.equal(entry.thread_id, BINDING.thread_id);
  assert.equal(entry.repo, BINDING.repo);
  assert.equal(entry.branch, BINDING.branch);
});

test('classifyObservation throws on a malformed observation', () => {
  assert.throws(
    () => classifyObservation(BINDING, { ...healthy(), merged: 'nope' }),
    /malformed BranchObservation/,
  );
  assert.throws(
    () => classifyObservation(BINDING, { ...healthy(), ahead: '1' }),
    /malformed BranchObservation/,
  );
  assert.throws(() => classifyObservation(BINDING, null), /malformed BranchObservation/);
});

test('classifyObservation throws referencing thread_id when the binding lacks id/thread_id', () => {
  assert.throws(() => classifyObservation({ id: BINDING.id }, healthy()), /thread_id/);
  assert.throws(() => classifyObservation({ thread_id: BINDING.thread_id }, healthy()), /thread_id/);
});
