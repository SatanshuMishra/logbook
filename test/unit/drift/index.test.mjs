import test from 'node:test';
import assert from 'node:assert/strict';
import * as drift from '../../../src/drift/index.mjs';

test('the drift barrel re-exports the full public surface', () => {
  assert.equal(typeof drift.classifyObservation, 'function');
  assert.equal(typeof drift.disposeBinding, 'function');
  assert.equal(typeof drift.branchSlug, 'function');
  assert.equal(typeof drift.reattach, 'function');
  assert.equal(typeof drift.runReconcile, 'function');
  assert.equal(typeof drift.closedBinding, 'function');
  assert.deepEqual({ ...drift.CLASSIFICATION_RANK }, { CRITICAL: 3, WARNING: 2, COMPLETE: 1 });
});

test('the barrel exports are the same references as the source modules', async () => {
  const { classifyObservation } = await import('../../../src/drift/classification.mjs');
  const { runReconcile } = await import('../../../src/drift/reconcile.mjs');
  assert.equal(drift.classifyObservation, classifyObservation);
  assert.equal(drift.runReconcile, runReconcile);
});
