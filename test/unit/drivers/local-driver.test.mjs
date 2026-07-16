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
