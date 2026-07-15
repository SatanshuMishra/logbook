import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';
import {
  EMPTY_TREE_SHA,
  LEDGER_ROOT_MESSAGE,
  LEDGER_INIT_IDENTITY,
  LEDGER_BACKENDS,
  DEFAULT_LEDGER_BRANCH,
  DEFAULT_REMOTE,
  MAX_SYNC_ATTEMPTS,
  assertBackend,
  ledgerRefName,
  mirrorRefName,
  fetchRefspecFor,
  mintLedgerRoot,
} from '../../../src/drivers/git-ledger.mjs';

const DETERMINISTIC_ROOT_SHA = '2977eb960796d6bfa5f4649d708d319a9c0125e2';

async function initRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'git-ledger-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await gitExec(dir, ['init', '-q']);
  return dir;
}

test('constants carry the exact pinned values', () => {
  assert.equal(EMPTY_TREE_SHA, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.equal(LEDGER_ROOT_MESSAGE, 'chore: initialize continuity ledger');
  assert.deepEqual(LEDGER_INIT_IDENTITY, {
    name: 'Continuity Ledger',
    email: 'ledger@continuity.invalid',
    date: '2020-01-01T00:00:00Z',
  });
  assert.deepEqual([...LEDGER_BACKENDS], ['orphan-branch', 'custom-ref']);
  assert.equal(DEFAULT_LEDGER_BRANCH, '_ledger');
  assert.equal(DEFAULT_REMOTE, 'origin');
  assert.equal(MAX_SYNC_ATTEMPTS, 5);
});

test('assertBackend accepts valid backends and rejects unknown', () => {
  assert.equal(assertBackend('orphan-branch'), 'orphan-branch');
  assert.equal(assertBackend('custom-ref'), 'custom-ref');
  assert.throws(() => assertBackend('local-dir'), /unknown ledger backend/);
  assert.throws(() => assertBackend(undefined), /unknown ledger backend/);
});

test('ledgerRefName maps each backend', () => {
  assert.equal(ledgerRefName('orphan-branch'), 'refs/heads/_ledger');
  assert.equal(ledgerRefName('orphan-branch', 'main-ledger'), 'refs/heads/main-ledger');
  assert.equal(ledgerRefName('custom-ref'), 'refs/ledger/_ledger');
  assert.equal(ledgerRefName('custom-ref', 'x'), 'refs/ledger/x');
  assert.throws(() => ledgerRefName('bogus'), /unknown ledger backend/);
});

test('mirrorRefName maps each backend', () => {
  assert.equal(mirrorRefName('orphan-branch'), 'refs/remotes/origin/_ledger');
  assert.equal(mirrorRefName('orphan-branch', 'l', 'upstream'), 'refs/remotes/upstream/l');
  assert.equal(mirrorRefName('custom-ref'), 'refs/ledger-remote/_ledger');
  assert.equal(mirrorRefName('custom-ref', 'l'), 'refs/ledger-remote/l');
});

test('fetchRefspecFor maps each backend', () => {
  assert.equal(fetchRefspecFor('orphan-branch'), '+refs/heads/_ledger:refs/remotes/origin/_ledger');
  assert.equal(
    fetchRefspecFor('orphan-branch', 'l', 'upstream'),
    '+refs/heads/l:refs/remotes/upstream/l',
  );
  assert.equal(fetchRefspecFor('custom-ref'), '+refs/ledger/*:refs/ledger-remote/*');
  assert.equal(fetchRefspecFor('custom-ref', 'l'), '+refs/ledger/*:refs/ledger-remote/*');
});

test('mintLedgerRoot is deterministic across independent repos', async (t) => {
  const a = await initRepo(t);
  const b = await initRepo(t);
  const shaA = await mintLedgerRoot(a);
  const shaB = await mintLedgerRoot(b);
  assert.equal(shaA, shaB);
  assert.equal(shaA, DETERMINISTIC_ROOT_SHA);
});

test('mintLedgerRoot writes the fixed identity, dates, tree and message', async (t) => {
  const dir = await initRepo(t);
  const sha = await mintLedgerRoot(dir);
  const { stdout } = await gitExec(dir, ['cat-file', 'commit', sha]);
  assert.match(stdout, /^tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904$/m);
  assert.match(stdout, /^author Continuity Ledger <ledger@continuity\.invalid> 1577836800 \+0000$/m);
  assert.match(stdout, /^committer Continuity Ledger <ledger@continuity\.invalid> 1577836800 \+0000$/m);
  assert.match(stdout, /\nchore: initialize continuity ledger\n?$/);
});
