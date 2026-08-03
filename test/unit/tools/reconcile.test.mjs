import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import reconcile from '../../../src/tools/reconcile.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';
import { makeFakeDriver } from '../drift/fake-driver.mjs';

const THREAD_A = '0123456789ABCDEFGHJKMNPQRS';
const THREAD_B = '0123456789ABCDEFGHJKMNPQRT';

function observation(overrides) {
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

function binding(id, threadId, branch) {
  return {
    id,
    thread_id: threadId,
    repo: 'acme/app',
    branch,
    status: 'active',
    first_commit: 'abc123',
    closed_at: null,
    closed_reason: null,
  };
}

function thread(id) {
  return { id, slug: id.toLowerCase(), title: 'T', status: 'active', completion_criteria: [] };
}

function fakeCtx(config) {
  const fake = makeFakeDriver(config);
  const ctx = {
    driver: fake.driver,
    projectDir: '/tmp/acme',
    userConfig: {},
    now: () => '2026-07-15T12:00:00Z',
  };
  return { fake, ctx };
}

test('reconcile returns {drift, dispositions} and short-circuits on a non-git driver', async (t) => {
  const ctx = await makeToolCtx(t);
  const result = await reconcile.handler(ctx, {});
  assert.deepEqual(result, { drift: [], dispositions: [], recovery_degraded: false });
});

test('reconcile writes an empty drift snapshot to the index when nothing drifted', async (t) => {
  const ctx = await makeToolCtx(t);
  await reconcile.handler(ctx, {});
  const raw = await readFile(join(ctx.driver.ledgerRoot, 'index', 'drift.json'), 'utf8');
  assert.deepEqual(JSON.parse(raw), {});
});

test('reconcile wraps runReconcile with exactly one commitAndReindex', async (t) => {
  const ctx = await makeToolCtx(t);
  let commits = 0;
  ctx.driver.commit = async () => { commits += 1; return { committed: false }; };
  await reconcile.handler(ctx, {});
  assert.equal(commits, 1);
});

test('reconcile persists the drift snapshot grouped by thread_id', async () => {
  const { fake, ctx } = fakeCtx({
    bindings: [
      binding('01BA1', THREAD_A, 'feat/a1'),
      binding('01BA2', THREAD_A, 'feat/a2'),
      binding('01BB1', THREAD_B, 'feat/b1'),
      binding('01BA3', THREAD_A, 'feat/a3'),
    ],
    threads: { [THREAD_A]: thread(THREAD_A), [THREAD_B]: thread(THREAD_B) },
    observations: {
      '01BA1': observation({ ahead: 2 }),
      '01BA2': observation({ behind: 1 }),
      '01BB1': observation({ ahead: 3 }),
      '01BA3': observation(),
    },
  });

  const result = await reconcile.handler(ctx, {});

  const snapshot = fake.indexFiles.drift;
  assert.deepEqual(Object.keys(snapshot).sort(), [THREAD_A, THREAD_B]);
  assert.deepEqual(snapshot[THREAD_A].map((e) => e.branch), ['feat/a1', 'feat/a2']);
  assert.deepEqual(snapshot[THREAD_B].map((e) => e.branch), ['feat/b1']);
  assert.ok(snapshot[THREAD_A].every((e) => e.thread_id === THREAD_A));
  assert.equal(snapshot[THREAD_B][0].classification, 'WARNING');
  assert.equal(result.drift.length, 3);
});

test('reconcile overwrites a stale drift snapshot wholesale when the run finds nothing', async () => {
  const { fake, ctx } = fakeCtx({
    bindings: [binding('01BA1', THREAD_A, 'feat/a1')],
    threads: { [THREAD_A]: thread(THREAD_A) },
    observations: { '01BA1': observation() },
    indexFiles: { drift: { [THREAD_B]: [{ thread_id: THREAD_B, branch: 'feat/stale' }] } },
  });

  await reconcile.handler(ctx, {});

  assert.deepEqual(fake.indexFiles.drift, {});
});

test('reconcile input schema is a closed empty object', () => {
  assert.equal(reconcile.inputSchema.additionalProperties, false);
  assert.deepEqual(reconcile.inputSchema.properties, {});
});
