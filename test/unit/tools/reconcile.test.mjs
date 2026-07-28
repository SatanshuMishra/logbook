import test from 'node:test';
import assert from 'node:assert/strict';
import reconcile from '../../../src/tools/reconcile.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

test('reconcile returns {drift, dispositions} and short-circuits on a non-git driver', async (t) => {
  const ctx = await makeToolCtx(t);
  const result = await reconcile.handler(ctx, {});
  assert.deepEqual(result, { drift: [], dispositions: [], recovery_degraded: false });
});

test('reconcile wraps runReconcile with exactly one commitAndReindex', async (t) => {
  const ctx = await makeToolCtx(t);
  let commits = 0;
  ctx.driver.commit = async () => { commits += 1; return { committed: false }; };
  await reconcile.handler(ctx, {});
  assert.equal(commits, 1);
});

test('reconcile input schema is a closed empty object', () => {
  assert.equal(reconcile.inputSchema.additionalProperties, false);
  assert.deepEqual(reconcile.inputSchema.properties, {});
});
