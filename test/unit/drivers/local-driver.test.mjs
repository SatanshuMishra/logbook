import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from '../../../src/drivers/local-driver.mjs';
import { gitExec } from '../../../src/util/git-exec.mjs';
import {
  commitFile,
  hostileConfigEnv,
  hostileGitEnvironment,
  withGitEnv,
} from '../../fixtures/git-repos.mjs';

async function scratchRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'local-driver-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'ledger');
}

const ABSENT_BIN = join(tmpdir(), 'local-driver-absent-bin');

async function trackedPaths(root, sha) {
  const { stdout } = await gitExec(root, ['ls-tree', '-r', '--name-only', sha]);
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function installedTrapHooks(root, trap) {
  let names;
  try {
    names = await readdir(join(root, '.git', 'hooks'));
  } catch {
    return [];
  }
  return names.filter((name) => trap.hookNames.includes(name)).sort();
}

async function foreignRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'local-driver-foreign-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await gitExec(dir, ['init', '-q']);
  return dir;
}

async function commitCount(repo) {
  const { code, stdout } = await gitExec(repo, ['rev-list', '--count', 'HEAD'], { check: false });
  return code === 0 ? Number(stdout.trim()) : 0;
}

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ULID_B = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

function makeThread(overrides = {}) {
  return {
    schema_version: 2,
    id: ULID_A,
    slug: 'my-thread',
    title: 'My Thread',
    status: 'active',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [
      { id: 'c1', text: 'ship it', done: false, kind: 'planned', struck_by: null },
    ],
    vcs_ref: null,
    external_refs: [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: '',
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

test('LocalDriver.activeThreadPointerPath is the sibling of the ledger root, outside it', async () => {
  const driver = new LocalDriver('/abs/base/ledger');
  assert.equal(await driver.activeThreadPointerPath(), '/abs/base/active-thread');
});

test('LocalDriver.commit degrades when the ledger root has no recovery repo', async () => {
  const driver = new LocalDriver('/abs/ledger');
  assert.deepEqual(await driver.commit('msg'), { committed: false, sha: null, empty: false, degraded: true });
});

test('LocalDriver.init creates a private recovery repo under the ledger root', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  assert.equal((await stat(join(root, '.git'))).isDirectory(), true);
  assert.equal(driver.isGit(), false);
});

test('LocalDriver.init leaves an existing recovery repo and its history intact', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  const first = await driver.commit('chore(ledger): open thread');
  await driver.init();
  const { stdout } = await gitExec(root, ['rev-parse', 'HEAD']);
  assert.equal(stdout.trim(), first.sha);
});

test('LocalDriver.commit records real history for the non-git store', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  const result = await driver.commit('chore(ledger): open thread');
  assert.equal(result.committed, true);
  assert.equal(result.empty, false);
  assert.match(result.sha, /^[0-9a-f]{40}$/);
  const log = await gitExec(root, ['log', '--format=%H %an <%ae> %s']);
  assert.equal(
    log.stdout.trim(),
    `${result.sha} Continuity Ledger <ledger@continuity.invalid> chore(ledger): open thread`,
  );
  assert.ok((await trackedPaths(root, result.sha)).includes(`threads/${ULID_A}.json`));
});

test('LocalDriver.commit accumulates one recovery commit per mutation', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.commit('chore(ledger): open thread');
  await driver.writeThread(makeThread({ id: ULID_B, slug: 'second' }));
  const second = await driver.commit('chore(ledger): open second thread');
  assert.equal(second.committed, true);
  const { stdout } = await gitExec(root, ['rev-list', '--count', 'HEAD']);
  assert.equal(stdout.trim(), '2');
});

test('LocalDriver.commit reports empty:true when nothing changed since the last commit', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  assert.equal((await driver.commit('chore(ledger): open thread')).committed, true);
  assert.deepEqual(
    await driver.commit('chore(ledger): nothing to record'),
    { committed: false, sha: null, empty: true, degraded: false },
  );
});

test('LocalDriver.commit keeps the derived index out of recovery history', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.writeIndexFile('by-slug', { 'my-thread': ULID_A });
  const result = await driver.commit('chore(ledger): open thread');
  const tracked = await trackedPaths(root, result.sha);
  assert.ok(tracked.includes(`threads/${ULID_A}.json`));
  assert.equal(tracked.some((path) => path.startsWith('index/')), false);
});

test('LocalDriver.init and commit degrade without throwing when git is unavailable', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await withGitEnv({ PATH: ABSENT_BIN }, async () => {
    assert.equal(await driver.init(), root);
    for (const sub of ['threads', 'bindings', 'decisions', 'sessions', 'index']) {
      assert.equal((await stat(join(root, sub))).isDirectory(), true);
    }
    await driver.writeThread(makeThread());
    assert.deepEqual(
      await driver.commit('chore(ledger): open thread'),
      { committed: false, sha: null, empty: false, degraded: true },
    );
    assert.deepEqual(await driver.readThread(ULID_A), makeThread());
  });
});

test('LocalDriver.commit degrades without throwing when the recovery repo is unusable', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await rm(join(root, '.git'), { recursive: true, force: true });
  await writeFile(join(root, '.git'), 'not a gitfile\n');
  await driver.writeThread(makeThread());
  assert.deepEqual(
    await driver.commit('chore(ledger): open thread'),
    { committed: false, sha: null, empty: false, degraded: true },
  );
});

test('LocalDriver pins the recovery repo despite an ambient GIT_DIR', async (t) => {
  const root = await scratchRoot(t);
  const hijack = join(root, '..', 'hijacked.git');
  const driver = new LocalDriver(root);
  const result = await withGitEnv({ GIT_DIR: hijack }, async () => {
    await driver.init();
    await driver.writeThread(makeThread());
    return driver.commit('chore(ledger): open thread');
  });
  assert.equal(result.committed, true);
  assert.equal((await stat(join(root, '.git'))).isDirectory(), true);
  await assert.rejects(() => stat(hijack), { code: 'ENOENT' });
  assert.ok((await trackedPaths(root, result.sha)).includes(`threads/${ULID_A}.json`));
});

test('LocalDriver runs no hook under a fully hostile ambient git config', async (t) => {
  const root = await scratchRoot(t);
  const trap = await hostileGitEnvironment(t);
  const driver = new LocalDriver(root);
  const result = await withGitEnv(hostileConfigEnv(trap), async () => {
    await driver.init();
    await driver.writeThread(makeThread());
    return driver.commit('chore(ledger): open thread');
  });
  await assert.rejects(() => stat(trap.marker), { code: 'ENOENT' });
  assert.deepEqual(await installedTrapHooks(root, trap), []);
  assert.equal(result.committed, true);
  assert.ok((await trackedPaths(root, result.sha)).includes(`threads/${ULID_A}.json`));
});

test('LocalDriver installs no template hook that would outlive the hostile env', async (t) => {
  const root = await scratchRoot(t);
  const trap = await hostileGitEnvironment(t);
  const driver = new LocalDriver(root);
  await withGitEnv({ GIT_TEMPLATE_DIR: trap.dir }, () => driver.init());
  await driver.writeThread(makeThread());
  const result = await driver.commit('chore(ledger): open thread');
  assert.deepEqual(await installedTrapHooks(root, trap), []);
  await assert.rejects(() => stat(trap.marker), { code: 'ENOENT' });
  assert.equal(result.committed, true);
});

test('LocalDriver tracks thread records despite a global core.excludesFile', async (t) => {
  const root = await scratchRoot(t);
  const trap = await hostileGitEnvironment(t);
  const driver = new LocalDriver(root);
  const result = await withGitEnv({ GIT_CONFIG_GLOBAL: trap.globalConfig }, async () => {
    await driver.init();
    await driver.writeThread(makeThread());
    return driver.commit('chore(ledger): open thread');
  });
  assert.equal(result.committed, true);
  assert.ok((await trackedPaths(root, result.sha)).includes(`threads/${ULID_A}.json`));
});

test('LocalDriver.init restores a deleted recovery .gitignore', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await rm(join(root, '.gitignore'), { force: true });
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.writeIndexFile('by-slug', { 'my-thread': ULID_A });
  const result = await driver.commit('chore(ledger): open thread');
  const tracked = await trackedPaths(root, result.sha);
  assert.ok(tracked.includes(`threads/${ULID_A}.json`));
  assert.equal(tracked.some((path) => path.startsWith('index/')), false);
});

test('LocalDriver.init re-asserts recovery signing config on an existing repo', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await gitExec(root, ['config', '--local', '--unset', 'commit.gpgsign'], { check: false });
  await gitExec(root, ['config', '--local', '--unset', 'tag.gpgsign'], { check: false });
  await driver.init();
  for (const key of ['commit.gpgsign', 'tag.gpgsign']) {
    const { stdout } = await gitExec(root, ['config', '--local', '--get', key]);
    assert.equal(stdout.trim(), 'false');
  }
});

test('LocalDriver.init repairs a recovery .git directory that is not a repo', async (t) => {
  const root = await scratchRoot(t);
  await mkdir(join(root, '.git'), { recursive: true });
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  const result = await driver.commit('chore(ledger): open thread');
  assert.equal(result.committed, true);
  assert.equal(result.degraded, false);
  assert.ok((await trackedPaths(root, result.sha)).includes(`threads/${ULID_A}.json`));
});

test('LocalDriver refuses a recovery .git that is a gitfile pointing elsewhere', async (t) => {
  const root = await scratchRoot(t);
  const foreign = await foreignRepo(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await rm(join(root, '.git'), { recursive: true, force: true });
  await writeFile(join(root, '.git'), `gitdir: ${join(foreign, '.git')}\n`);
  await driver.writeThread(makeThread());
  const result = await driver.commit('chore(ledger): open thread');
  assert.equal(result.committed, false);
  assert.equal(await commitCount(foreign), 0);
});

test('LocalDriver refuses a recovery .git symlinked into another repo', async (t) => {
  const root = await scratchRoot(t);
  const foreign = await foreignRepo(t);
  await mkdir(root, { recursive: true });
  await symlink(join(foreign, '.git'), join(root, '.git'));
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  const result = await driver.commit('chore(ledger): open thread');
  assert.equal(result.committed, false);
  assert.equal(await commitCount(foreign), 0);
  const signing = await gitExec(foreign, ['config', '--local', '--get', 'commit.gpgsign'], { check: false });
  assert.equal(signing.stdout.trim(), '');
});

test('LocalDriver refuses a recovery .git directory holding an unrelated repository', async (t) => {
  const root = await scratchRoot(t);
  await mkdir(root, { recursive: true });
  await gitExec(root, ['init', '-q', '-b', 'main']);
  await gitExec(root, ['config', 'user.name', 'Stranger']);
  await gitExec(root, ['config', 'user.email', 'stranger@example.invalid']);
  const stranger = await commitFile(root, 'unrelated.txt', 'stranger history\n', 'chore: stranger history');
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  assert.deepEqual(
    await driver.commit('chore(ledger): open thread'),
    { committed: false, sha: null, empty: false, degraded: true },
  );
  assert.equal(await commitCount(root), 1);
  const head = await gitExec(root, ['rev-parse', 'HEAD']);
  assert.equal(head.stdout.trim(), stranger);
  const branch = await gitExec(root, ['symbolic-ref', '--quiet', 'HEAD']);
  assert.equal(branch.stdout.trim(), 'refs/heads/main');
  const staged = await gitExec(root, ['diff', '--cached', '--quiet'], { check: false });
  assert.equal(staged.code, 0);
  const signing = await gitExec(root, ['config', '--local', '--get', 'commit.gpgsign'], { check: false });
  assert.equal(signing.stdout.trim(), '');
  await assert.rejects(() => stat(join(root, '.gitignore')), { code: 'ENOENT' });
  assert.deepEqual(await driver.readThread(ULID_A), makeThread());
});

test('LocalDriver.commit ignores an ambient GIT_AUTHOR_DATE and GIT_COMMITTER_DATE', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  const result = await withGitEnv(
    { GIT_AUTHOR_DATE: '2001-02-03T04:05:06Z', GIT_COMMITTER_DATE: '2001-02-03T04:05:06Z' },
    async () => {
      await driver.init();
      await driver.writeThread(makeThread());
      return driver.commit('chore(ledger): open thread');
    },
  );
  assert.equal(result.committed, true);
  const { stdout } = await gitExec(root, ['log', '-1', '--format=%aI %cI', result.sha]);
  const [authored, committed] = stdout.trim().split(' ');
  assert.equal(authored.startsWith('2001-'), false);
  assert.equal(committed.startsWith('2001-'), false);
});

test('LocalDriver.commit reports degraded:false on a healthy recovery commit', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeThread(makeThread());
  assert.equal((await driver.commit('chore(ledger): open thread')).degraded, false);
  assert.equal((await driver.commit('chore(ledger): nothing to record')).degraded, false);
});

test('LocalDriver.commit rejects a non-string message', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await assert.rejects(() => driver.commit(42), /message/);
  await assert.rejects(() => driver.commit(''), /message/);
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
  await assert.rejects(() => driver.writeThread(makeThread({ status: 'bogus' })), /Thread\.status/);
});

test('readThread upcasts a stored v1 record to v2 in memory', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const stored = makeThread({
    schema_version: 1,
    completion_criteria: [{ text: 'ship it', done: false }, { text: 'measure', done: true }],
  });
  await writeFile(join(root, 'threads', `${ULID_A}.json`), JSON.stringify(stored, null, 2) + '\n');
  const record = await driver.readThread(ULID_A);
  assert.equal(record.schema_version, 2);
  assert.deepEqual(record.completion_criteria, [
    { id: 'c1', text: 'ship it', done: false, kind: 'planned', struck_by: null },
    { id: 'c2', text: 'measure', done: true, kind: 'planned', struck_by: null },
  ]);
});

test('a stored v1 thread with no completion_criteria stays writable after the upcast', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const stored = makeThread({ schema_version: 1, completion_criteria: [] });
  await writeFile(join(root, 'threads', `${ULID_A}.json`), JSON.stringify(stored, null, 2) + '\n');
  const record = await driver.readThread(ULID_A);
  await driver.writeThread({ ...record, spine: { ...record.spine, next_step: 'define a DoD' } });
  const reread = await driver.readThread(ULID_A);
  assert.equal(reread.schema_version, 2);
  assert.deepEqual(reread.completion_criteria, []);
  assert.equal(reread.spine.next_step, 'define a DoD');
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
  await assert.rejects(() => driver.writeBinding(makeBinding({ status: 'nope' })), /BranchBinding\.status/);
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

test('appendSessionEvent writes a per-event file under sessions/<threadId>', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const path = await driver.appendSessionEvent(ULID_A, '2026-07-14T10:00:00.500Z', 'claude', '# note\n');
  assert.equal(path, join(root, 'sessions', ULID_A, '2026-07-14T10-00-00-500Z--claude.md'));
  assert.equal(await (await import('node:fs/promises')).readFile(path, 'utf8'), '# note\n');
});

test('appendSessionEvent sanitizes an actor with unsafe characters', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const path = await driver.appendSessionEvent(ULID_A, '2026-07-14T10:00:00Z', 'agent x/y', 'body');
  assert.equal(path, join(root, 'sessions', ULID_A, '2026-07-14T10-00-00Z--agent-x-y.md'));
});

test('appendSessionEvent rejects a non-ULID threadId', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await assert.rejects(() => driver.appendSessionEvent('not-a-ulid', '2026-07-14T10:00:00Z', 'claude', 'x'), /ULID/);
});

test('appendSessionEvent rejects a non-string markdown body', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await assert.rejects(() => driver.appendSessionEvent(ULID_A, '2026-07-14T10:00:00Z', 'claude', 42), /markdown/);
});

test('readIndexFile returns {} for a missing object index and [] for missing resumable', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  assert.deepEqual(await driver.readIndexFile('by-slug'), {});
  assert.deepEqual(await driver.readIndexFile('resumable'), []);
});

test('writeIndexFile round-trips via readIndexFile and persists canonical bytes', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  const obj = { 'my-thread': ULID_A };
  const path = await driver.writeIndexFile('by-slug', obj);
  assert.equal(path, join(root, 'index', 'by-slug.json'));
  assert.deepEqual(await driver.readIndexFile('by-slug'), obj);
  const raw = await (await import('node:fs/promises')).readFile(path, 'utf8');
  assert.equal(raw, JSON.stringify(obj, null, 2) + '\n');
});

test('deleteIndexFile removes an index file and reports an absent one without throwing', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  await driver.writeIndexFile('briefing', { thread_id: ULID_A, rendered: 'x' });
  assert.equal(await driver.deleteIndexFile('briefing'), true);
  assert.deepEqual(await driver.readIndexFile('briefing'), {});
  assert.equal(await driver.deleteIndexFile('briefing'), false);
});

test('deleteIndexFile refuses a name that could escape the index directory', async (t) => {
  const root = await scratchRoot(t);
  const driver = new LocalDriver(root);
  await driver.init();
  for (const name of ['../threads/x', 'a/b', '', null]) {
    await assert.rejects(
      () => driver.deleteIndexFile(name),
      /deleteIndexFile: invalid index name/,
    );
  }
});
