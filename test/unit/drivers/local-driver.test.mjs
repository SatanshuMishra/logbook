import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from '../../../src/drivers/local-driver.mjs';

async function scratchRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'local-driver-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger');
}

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_B = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

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

function makeBinding(overrides = {}) {
  return {
    id: ULID_A,
    thread_id: ULID_B,
    repo: '/repo',
    branch: 'feat/x',
    status: 'active',
    created_at: '2026-07-14T10:00:00Z',
    closed_at: null,
    closed_reason: null,
    first_commit: null,
    trailer_present: false,
    ...overrides,
  };
}

test('LocalDriver.isGit is synchronous and returns false', () => {
  const driver = new LocalDriver('/abs/ledger');
  assert.equal(driver.isGit(), false);
});

test('LocalDriver rejects a non-absolute ledger root', () => {
  assert.throws(() => new LocalDriver('relative/ledger'), /absolute/);
});

test('LocalDriver rejects an empty ledger root', () => {
  assert.throws(() => new LocalDriver(''), /non-empty/);
});

test('LocalDriver.init creates the ledger root and record subdirs', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  for (const sub of ['threads', 'bindings', 'decisions', 'sessions', 'index']) {
    const s = await stat(join(root, sub));
    assert.equal(s.isDirectory(), true);
  }
});

test('LocalDriver.root returns the absolute ledger root', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  assert.equal(await driver.root(), root);
});

test('LocalDriver.commit reports committed:false for the non-git store', async () => {
  const driver = new LocalDriver('/abs/ledger');
  assert.deepEqual(await driver.commit('msg'), { committed: false });
});

test('LocalDriver.sync reports synced:false for the non-git store', async () => {
  const driver = new LocalDriver('/abs/ledger');
  assert.deepEqual(await driver.sync(), { synced: false });
});

test('LocalDriver.observeBranch throws git-drivers-only', async () => {
  const driver = new LocalDriver('/abs/ledger');
  await assert.rejects(() => driver.observeBranch({}), /observeBranch: git drivers only/);
});

test('LocalDriver.observeNewBranch throws git-drivers-only', async () => {
  const driver = new LocalDriver('/abs/ledger');
  await assert.rejects(() => driver.observeNewBranch('repo', 'branch'), /observeNewBranch: git drivers only/);
});

test('LocalDriver.listRepoBranches throws git-drivers-only', async () => {
  const driver = new LocalDriver('/abs/ledger');
  await assert.rejects(() => driver.listRepoBranches('repo'), /listRepoBranches: git drivers only/);
});

test('writeThread validates, atomic-writes, and round-trips via readThread', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const thread = makeThread();
  const path = await driver.writeThread(thread);
  assert.equal(path, join(root, 'threads', `${ULID_A}.json`));
  assert.deepEqual(await driver.readThread(ULID_A), thread);
});

test('writeThread persists the canonical serializeRecord bytes', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const thread = makeThread();
  await driver.writeThread(thread);
  const raw = await (await import('node:fs/promises')).readFile(join(root, 'threads', `${ULID_A}.json`), 'utf8');
  assert.equal(raw, JSON.stringify(thread, null, 2) + '\n');
});

test('writeThread rejects an invalid record before writing', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await assert.rejects(() => driver.writeThread(makeThread({ status: 'bogus' })), /schema validation/);
});

test('readThread returns null for a missing thread', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  assert.equal(await driver.readThread(ULID_B), null);
});

test('listThreads returns every stored thread and [] on an empty store', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  assert.deepEqual(await driver.listThreads(), []);
  await driver.writeThread(makeThread({ id: ULID_A }));
  await driver.writeThread(makeThread({ id: ULID_B, slug: 'second' }));
  const ids = (await driver.listThreads()).map((r) => r.id).sort();
  assert.deepEqual(ids, [ULID_A, ULID_B].sort());
});

test('writeBinding validates and round-trips via readBinding', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const binding = makeBinding();
  const path = await driver.writeBinding(binding);
  assert.equal(path, join(root, 'bindings', `${ULID_A}.json`));
  assert.deepEqual(await driver.readBinding(ULID_A), binding);
});

test('writeBinding rejects an invalid record before writing', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await assert.rejects(() => driver.writeBinding(makeBinding({ status: 'nope' })), /schema validation/);
});

test('listBindings returns every stored binding and [] on an empty store', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  assert.deepEqual(await driver.listBindings(), []);
  await driver.writeBinding(makeBinding({ id: ULID_A }));
  await driver.writeBinding(makeBinding({ id: ULID_B }));
  const ids = (await driver.listBindings()).map((r) => r.id).sort();
  assert.deepEqual(ids, [ULID_A, ULID_B].sort());
});

test('nextDecisionNumber starts at 0001 on an empty store', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  assert.equal(await driver.nextDecisionNumber(), '0001');
});

test('writeDecision writes raw markdown and readDecision returns it verbatim', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const md = '---\nStatus: accepted\nThread-Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n---\n\n# Adopt X\n';
  const path = await driver.writeDecision('0001', 'adopt-x', md);
  assert.equal(path, join(root, 'decisions', '0001-adopt-x.md'));
  assert.equal(await driver.readDecision('0001'), md);
});

test('nextDecisionNumber advances past the highest existing decision', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeDecision('0001', 'first', 'a');
  await driver.writeDecision('0002', 'second', 'b');
  assert.equal(await driver.nextDecisionNumber(), '0003');
});

test('writeDecision rejects a slug that could escape the decisions directory', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await assert.rejects(() => driver.writeDecision('0001', '../evil', 'x'), /invalid slug/);
  await assert.rejects(() => driver.writeDecision('0001', 'Has_Caps', 'x'), /invalid slug/);
});

test('writeDecision rejects a non-string markdown body', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await assert.rejects(() => driver.writeDecision('0001', 'ok', { not: 'a string' }), /markdown/);
});

test('readDecision returns null when the number is absent', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  assert.equal(await driver.readDecision('0007'), null);
});

test('listDecisions returns {nnnn, slug} pairs sorted ascending', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeDecision('0002', 'second', 'b');
  await driver.writeDecision('0001', 'first', 'a');
  assert.deepEqual(await driver.listDecisions(), [
    { nnnn: '0001', slug: 'first' },
    { nnnn: '0002', slug: 'second' },
  ]);
});
