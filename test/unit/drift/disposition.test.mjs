import test from 'node:test';
import assert from 'node:assert/strict';
import { disposeBinding } from '../../../src/drift/disposition.mjs';

const BINDING_ID = '0123456789ABCDEFGHJKMNPQRV';
const THREAD_ID = '0123456789ABCDEFGHJKMNPQRS';

function entry(signals) {
  return { binding_id: BINDING_ID, thread_id: THREAD_ID, repo: 'acme/app', branch: 'feat/x', classification: 'WARNING', signals };
}

function thread(status, criteria) {
  return { id: THREAD_ID, status, completion_criteria: criteria ?? [] };
}

const branchGoneMerged = { code: 'branch-gone', classification: 'COMPLETE', detail: 'merged' };
const branchGoneDeleted = { code: 'branch-gone', classification: 'WARNING', detail: 'deleted' };
const squashMerged = { code: 'squash-merged', classification: 'COMPLETE', detail: 'squash-merged' };
const keyFileModified = { code: 'key-file-modified', classification: 'WARNING', detail: 'src/a' };
const divergence = { code: 'divergence', classification: 'WARNING', detail: 'ahead 1, behind 0' };

test('merged via branch-gone(merged) marks the binding merged', () => {
  const d = disposeBinding(entry([branchGoneMerged]), thread('active', [{ text: 'x', done: true }]));
  assert.equal(d.action, 'mark-merged');
  assert.equal(d.binding_status, 'merged');
  assert.equal(d.closed_reason, 'merged');
  assert.equal(d.thread_recommendation, 'complete');
  assert.equal(d.dod_ready, true);
  assert.equal(d.binding_id, BINDING_ID);
  assert.equal(d.thread_id, THREAD_ID);
});

test('merged recommends none when the thread is terminal', () => {
  const d = disposeBinding(entry([branchGoneMerged]), thread('done', [{ text: 'x', done: true }]));
  assert.equal(d.action, 'mark-merged');
  assert.equal(d.thread_recommendation, 'none');
});

test('merged reports dod_ready false when a criterion is unchecked', () => {
  const d = disposeBinding(entry([branchGoneMerged]), thread('active', [{ text: 'x', done: false }]));
  assert.equal(d.dod_ready, false);
});

test('merged reports dod_ready true when the only unchecked criterion was struck', () => {
  const d = disposeBinding(entry([branchGoneMerged]), thread('active', [
    { id: 'c1', text: 'x', done: true, struck_by: null },
    { id: 'c2', text: 'y', done: false, struck_by: '0007-the-plan-was-wrong' },
  ]));
  assert.equal(d.dod_ready, true);
});

test('squash-merged CODE marks merged even when the entry-max is WARNING', () => {
  const d = disposeBinding(entry([keyFileModified, squashMerged, branchGoneMerged]), thread('active', []));
  assert.equal(d.action, 'mark-merged');
  assert.equal(d.binding_status, 'merged');
});

test('orphaned via branch-gone(deleted) marks the binding orphaned', () => {
  const d = disposeBinding(entry([branchGoneDeleted]), thread('active'));
  assert.equal(d.action, 'mark-orphaned');
  assert.equal(d.binding_status, 'orphaned');
  assert.equal(d.closed_reason, 'deleted');
  assert.equal(d.thread_recommendation, 'reopen-paused');
  assert.equal(d.dod_ready, false);
});

test('orphaned recommends none when the thread is terminal', () => {
  const d = disposeBinding(entry([branchGoneDeleted]), thread('abandoned'));
  assert.equal(d.thread_recommendation, 'none');
});

test('re-verify touches no binding status for divergence-only drift', () => {
  const d = disposeBinding(entry([divergence]), thread('active'));
  assert.equal(d.action, 're-verify');
  assert.equal(d.binding_status, null);
  assert.equal(d.closed_reason, null);
  assert.equal(d.thread_recommendation, 're-verify');
  assert.equal(d.dod_ready, false);
});

test('a null thread degrades dod_ready to false while still emitting the merged action', () => {
  const d = disposeBinding(entry([branchGoneMerged]), null);
  assert.equal(d.action, 'mark-merged');
  assert.equal(d.thread_recommendation, 'complete');
  assert.equal(d.dod_ready, false);
});

test('disposeBinding throws on an entry without a signals array', () => {
  assert.throws(() => disposeBinding({}, thread('active')), /signals/);
});
