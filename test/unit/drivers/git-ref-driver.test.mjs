import test from 'node:test';
import assert from 'node:assert/strict';
import { GitRefDriver, resolveIntegrationBase } from '../../../src/drivers/git-ref-driver.mjs';
import { initGitRepo, makeGitDriver, initBareRemote, initGitRepoWithRemote, commitFile, makeTempDir } from '../../fixtures/git-repos.mjs';
import { readFile, stat, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { mintLedgerRoot } from '../../../src/drivers/git-ledger.mjs';

const DETERMINISTIC_ROOT_SHA = '2977eb960796d6bfa5f4649d708d319a9c0125e2';

const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

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

test('GitRefDriver.isGit is synchronous and returns true', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  assert.equal(driver.isGit(), true);
});

test('GitRefDriver derives orphan-branch refs from the backend helpers', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  assert.equal(driver.ledgerRef, 'refs/heads/_ledger');
  assert.equal(driver.mirrorRef, 'refs/remotes/origin/_ledger');
  assert.equal(driver.fetchRefspec, '+refs/heads/_ledger:refs/remotes/origin/_ledger');
});

test('GitRefDriver rejects an unknown backend', async (t) => {
  const repo = await initGitRepo(t);
  assert.throws(
    () => new GitRefDriver({ repoDir: repo, worktreeDir: '/abs/wt', backend: 'local-dir' }),
    /unknown ledger backend/,
  );
});

test('GitRefDriver rejects a missing repoDir', () => {
  assert.throws(() => new GitRefDriver({ worktreeDir: '/abs/wt' }), /repoDir/);
});

test('GitRefDriver.root returns the worktree directory', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  assert.equal(await driver.root(), driver.worktreeDir);
});

test('init mints the deterministic orphan root on the ledger ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const { stdout } = await gitExec(repo, ['rev-list', '--max-parents=0', driver.ledgerRef]);
  assert.equal(stdout.trim(), DETERMINISTIC_ROOT_SHA);
});

test('init commits both scaffold files into the ledger ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const attrs = await gitExec(repo, ['show', `${driver.ledgerRef}:.gitattributes`]);
  assert.equal(attrs.stdout, 'sessions/**/*.md merge=union\n');
  const ignore = await gitExec(repo, ['show', `${driver.ledgerRef}:.gitignore`]);
  assert.equal(ignore.stdout, 'index/\n');
});

test('init checks out a detached worktree OUTSIDE the user repo working tree', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const s = await stat(join(driver.worktreeDir, '.gitattributes'));
  assert.equal(s.isFile(), true);
  const status = await gitExec(repo, ['status', '--porcelain']);
  assert.equal(status.stdout.trim(), '');
});

test('init is idempotent and adopts the existing ref without a new commit', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const first = (await gitExec(repo, ['rev-parse', driver.ledgerRef])).stdout.trim();
  await driver.init();
  const second = (await gitExec(repo, ['rev-parse', driver.ledgerRef])).stdout.trim();
  assert.equal(second, first);
});

test('init refuses to adopt a ref whose root is not the empty tree', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  const foreign = await mintForeignRoot(repo);
  await gitExec(repo, ['update-ref', driver.ledgerRef, foreign]);
  await assert.rejects(() => driver.init(), /not the empty tree/);
});

async function mintForeignRoot(repo) {
  await mkdir(join(repo, '.ledger-foreign'), { recursive: true });
  await writeFile(join(repo, '.ledger-foreign', 'marker'), 'foreign\n');
  await gitExec(repo, ['add', '.ledger-foreign/marker']);
  const treeSha = (await gitExec(repo, ['write-tree'])).stdout.trim();
  await gitExec(repo, ['reset', '-q']);
  return (await gitExec(
    repo,
    ['commit-tree', treeSha, '-m', 'foreign root'],
    { env: { GIT_AUTHOR_NAME: 'X', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'X', GIT_COMMITTER_EMAIL: 'x@x' } },
  )).stdout.trim();
}

test('GitRefDriver.init never creates a nested recovery repo inside its worktree', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  assert.equal((await stat(join(driver.worktreeDir, '.git'))).isDirectory(), false);
  const { stdout } = await gitExec(driver.worktreeDir, ['rev-parse', '--git-common-dir']);
  const commonDir = resolve(driver.worktreeDir, stdout.trim());
  assert.notEqual(commonDir, join(driver.worktreeDir, '.git'));
  assert.equal(await realpath(commonDir), await realpath(join(repo, '.git')));
});

test('GitRefDriver commits land on the ledger ref, not on a private recovery branch', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  const result = await driver.commit('feat: add thread');
  const tip = await gitExec(repo, ['rev-parse', driver.ledgerRef]);
  assert.equal(tip.stdout.trim(), result.sha);
});

test('GitRefDriver.commit rejects a non-string or empty message', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  await assert.rejects(() => driver.commit(42), /message must be a non-empty string/);
  await assert.rejects(() => driver.commit(''), /message must be a non-empty string/);
  const tip = await gitExec(repo, ['log', '--format=%s', driver.ledgerRef]);
  assert.equal(tip.stdout.includes('42'), false);
});

test('commit reports empty when nothing is staged', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  assert.deepEqual(await driver.commit('chore: noop'), { committed: false, sha: null, empty: true, degraded: false });
});

test('commit persists a written thread into the ledger ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  const result = await driver.commit('feat: add thread');
  assert.equal(result.committed, true);
  assert.equal(result.empty, false);
  assert.match(result.sha, /^[0-9a-f]{40}$/);
  const show = await gitExec(repo, ['show', `${driver.ledgerRef}:threads/${ULID_A}.json`]);
  assert.equal(JSON.parse(show.stdout).id, ULID_A);
});

test('commit never writes the derived index/ into the ledger ref', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeIndexFile('by-slug', { 'my-thread': ULID_A });
  await driver.writeThread(makeThread());
  await driver.commit('feat: add thread');
  const tree = await gitExec(repo, ['ls-tree', '-r', '--name-only', driver.ledgerRef]);
  assert.equal(tree.stdout.includes('index/'), false);
  assert.equal(tree.stdout.includes(`threads/${ULID_A}.json`), true);
});

test('custom-ref backend uses the refs/ledger/* namespace', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo, { backend: 'custom-ref' });
  assert.equal(driver.ledgerRef, 'refs/ledger/_ledger');
  await driver.init();
  const { stdout } = await gitExec(repo, ['rev-parse', '--verify', 'refs/ledger/_ledger']);
  assert.match(stdout.trim(), /^[0-9a-f]{40}$/);
  const heads = await gitExec(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/_ledger'], { check: false });
  assert.notEqual(heads.code, 0);
});

test('custom-ref init appends the ledger fetch refspec without clobbering existing fetch config', async (t) => {
  const repo = await initGitRepo(t);
  const remote = await initBareRemote(t);
  await gitExec(repo, ['remote', 'add', 'origin', remote]);
  const before = await gitExec(repo, ['config', '--get-all', 'remote.origin.fetch']);
  assert.equal(before.stdout.includes('+refs/heads/*:refs/remotes/origin/*'), true);
  const driver = await makeGitDriver(t, repo, { backend: 'custom-ref' });
  await driver.init();
  const after = await gitExec(repo, ['config', '--get-all', 'remote.origin.fetch']);
  assert.equal(after.stdout.includes('+refs/heads/*:refs/remotes/origin/*'), true);
  assert.equal(after.stdout.includes('+refs/ledger/*:refs/ledger-remote/*'), true);
});

test('custom-ref init is idempotent and does not duplicate the fetch refspec', async (t) => {
  const repo = await initGitRepo(t);
  const remote = await initBareRemote(t);
  await gitExec(repo, ['remote', 'add', 'origin', remote]);
  const driver = await makeGitDriver(t, repo, { backend: 'custom-ref' });
  await driver.init();
  await driver.init();
  const after = await gitExec(repo, ['config', '--get-all', 'remote.origin.fetch']);
  const count = after.stdout.split('\n').filter((l) => l.trim() === '+refs/ledger/*:refs/ledger-remote/*').length;
  assert.equal(count, 1);
});

test('resolveIntegrationBase honors the LEDGER_BASE_REF override first', async (t) => {
  const repo = await initGitRepo(t);
  process.env.LEDGER_BASE_REF = 'refs/custom-base';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  assert.equal(await resolveIntegrationBase(repo), 'refs/custom-base');
});

test('resolveIntegrationBase reads origin/HEAD when no override is set', async (t) => {
  const { repo } = await initGitRepoWithRemote(t);
  delete process.env.LEDGER_BASE_REF;
  assert.equal(await resolveIntegrationBase(repo), 'origin/main');
});

test('resolveIntegrationBase falls back to origin/main when origin/HEAD is absent', async (t) => {
  const { repo } = await initGitRepoWithRemote(t);
  delete process.env.LEDGER_BASE_REF;
  await gitExec(repo, ['remote', 'set-head', 'origin', '-d']);
  assert.equal(await resolveIntegrationBase(repo), 'origin/main');
});

test('resolveIntegrationBase returns null when no base is resolvable', async (t) => {
  const repo = await initGitRepo(t);
  delete process.env.LEDGER_BASE_REF;
  assert.equal(await resolveIntegrationBase(repo), null);
});

async function featureRepoMergedInto(t) {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  const featureHead = await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await gitExec(repo, ['checkout', '-q', 'main']);
  await gitExec(repo, ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature'], { env: { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } });
  await gitExec(repo, ['checkout', '-q', 'feature']);
  return { repo, featureHead };
}

test('observeBranch reports a merged live branch against the base override', async (t) => {
  const { repo, featureHead } = await featureRepoMergedInto(t);
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeBranch({ repo, branch: 'feature', first_commit: null });
  assert.equal(obs.branch_exists, true);
  assert.equal(obs.head_sha, featureHead);
  assert.equal(obs.merged, true);
  assert.equal(obs.first_commit_present, true);
  assert.equal(obs.force_push_detected, false);
  assert.deepEqual(obs.key_files_deleted, []);
  assert.deepEqual(obs.key_files_modified, []);
});

test('observeBranch reports an unmerged live branch (no signal territory)', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeBranch({ repo, branch: 'feature', first_commit: null });
  assert.equal(obs.merged, false);
  assert.equal(obs.squash_merged, false);
  assert.equal(obs.ahead, 0);
  assert.equal(obs.behind, 0);
  assert.equal(obs.diverged_from_upstream, false);
});

test('observeBranch reports head-missing when the recorded first_commit was rewritten away', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  const firstCommit = await commitFile(repo, 'feat.txt', 'v1\n', 'feat: v1');
  await gitExec(repo, ['commit', '-q', '--amend', '--no-verify', '-m', 'feat: v1 rewritten'], { env: { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } });
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeBranch({ repo, branch: 'feature', first_commit: firstCommit });
  assert.equal(obs.branch_exists, true);
  assert.equal(obs.first_commit_present, false);
});

test('observeBranch computes ahead/behind and divergence against origin/<branch>', async (t) => {
  const { repo } = await initGitRepoWithRemote(t);
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  await commitFile(repo, 'a.txt', 'a\n', 'feat: a');
  await gitExec(repo, ['push', '-q', 'origin', 'feature']);
  await gitExec(repo, ['fetch', '-q', 'origin']);
  await gitExec(repo, ['reset', '-q', '--hard', 'main']);
  await commitFile(repo, 'b.txt', 'b\n', 'feat: b');
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeBranch({ repo, branch: 'feature', first_commit: null });
  assert.equal(obs.ahead, 1);
  assert.equal(obs.behind, 1);
  assert.equal(obs.diverged_from_upstream, true);
});

test('observeBranch validates the binding at the boundary', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await assert.rejects(() => driver.observeBranch(null), /binding must be an object/);
  await assert.rejects(() => driver.observeBranch({ branch: 'x' }), /binding\.repo/);
  await assert.rejects(() => driver.observeBranch({ repo, branch: '' }), /binding\.branch/);
});

test('observeBranch reports merged:true best-effort for a merged-then-pruned branch', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  const firstCommit = await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await gitExec(repo, ['checkout', '-q', 'main']);
  await gitExec(repo, ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature'], { env: { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } });
  await gitExec(repo, ['branch', '-q', '-D', 'feature']);
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeBranch({ repo, branch: 'feature', first_commit: firstCommit });
  assert.equal(obs.branch_exists, false);
  assert.equal(obs.head_sha, null);
  assert.equal(obs.first_commit_present, true);
  assert.equal(obs.merged, true);
});

test('observeBranch reports merged:false for a deleted-unmerged branch', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  const firstCommit = await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await gitExec(repo, ['checkout', '-q', 'main']);
  await gitExec(repo, ['branch', '-q', '-D', 'feature']);
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeBranch({ repo, branch: 'feature', first_commit: firstCommit });
  assert.equal(obs.branch_exists, false);
  assert.equal(obs.merged, false);
  assert.equal(obs.squash_merged, false);
  assert.equal(obs.first_commit_present, true);
});

test('observeBranch degrades honestly for a deleted branch with a null first_commit', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeBranch({ repo, branch: 'gone', first_commit: null });
  assert.equal(obs.branch_exists, false);
  assert.equal(obs.merged, false);
  assert.equal(obs.squash_merged, false);
  assert.equal(obs.first_commit_present, true);
});

test('observeNewBranch returns the first commit and its Thread-Id trailer', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  await gitExec(repo, ['commit', '-q', '--allow-empty', '--no-verify', '-m', 'feat: work\n\nThread-Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV'], { env: { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } });
  const first = (await gitExec(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeNewBranch(repo, 'feature');
  assert.equal(obs.first_commit, first);
  assert.equal(obs.thread_id_trailer, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
});

test('observeNewBranch returns nulls for a branch that carries no trailer', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });
  const driver = await makeGitDriver(t, repo);
  const obs = await driver.observeNewBranch(repo, 'feature');
  assert.match(obs.first_commit, /^[0-9a-f]{40}$/);
  assert.equal(obs.thread_id_trailer, null);
});

test('observeNewBranch returns nulls for a missing branch', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  const driver = await makeGitDriver(t, repo);
  assert.deepEqual(await driver.observeNewBranch(repo, 'nope'), { thread_id_trailer: null, first_commit: null });
});

test('listRepoBranches returns the feature repo branch names', async (t) => {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['branch', 'feature-x']);
  await gitExec(repo, ['branch', 'fix/y']);
  const driver = await makeGitDriver(t, repo);
  const branches = (await driver.listRepoBranches(repo)).sort();
  assert.deepEqual(branches, ['feature-x', 'fix/y', 'main'].sort());
});

test('listRepoBranches validates repo at the boundary', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await assert.rejects(() => driver.listRepoBranches(''), /repo must be a non-empty string/);
});

test('sync is a no-op with attempts:0 when there is no remote', async (t) => {
  const repo = await initGitRepo(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  assert.deepEqual(await driver.sync(), { synced: false, pushed: false, merged: false, remote: false, attempts: 0 });
});

test('sync creates the remote ledger ref on first publish', async (t) => {
  const { repo, remote } = await initGitRepoWithRemote(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.commit('feat: add thread');
  const result = await driver.sync();
  assert.equal(result.synced, true);
  assert.equal(result.pushed, true);
  assert.equal(result.remote, true);
  const onRemote = await gitExec(remote, ['rev-parse', '--verify', 'refs/heads/_ledger']);
  assert.match(onRemote.stdout.trim(), /^[0-9a-f]{40}$/);
});

test('sync fast-forward pushes when the remote ledger is behind', async (t) => {
  const { repo } = await initGitRepoWithRemote(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.commit('feat: one');
  await driver.sync();
  await driver.writeThread(makeThread({ id: '01BX5ZZKBKACTAV9WEVGEMMVRZ', slug: 'two' }));
  await driver.commit('feat: two');
  const result = await driver.sync();
  assert.equal(result.pushed, true);
  assert.equal(result.merged, false);
});

test('sync returns synced without pushing when already up to date', async (t) => {
  const { repo } = await initGitRepoWithRemote(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(makeThread());
  await driver.commit('feat: one');
  await driver.sync();
  const result = await driver.sync();
  assert.equal(result.synced, true);
  assert.equal(result.pushed, false);
  assert.equal(result.merged, false);
});

async function twoClones(t) {
  const remote = await initBareRemote(t);
  const cloneA = await makeTempDir(t, 'git-driver-cloneA-');
  const cloneB = await makeTempDir(t, 'git-driver-cloneB-');
  for (const dir of [cloneA, cloneB]) {
    await gitExec(dir, ['clone', '-q', remote, '.']);
    await gitExec(dir, ['config', 'user.name', 'Test User']);
    await gitExec(dir, ['config', 'user.email', 'test@example.com']);
  }
  return { remote, cloneA, cloneB };
}

test('two clones init the identical deterministic orphan root before any push', async (t) => {
  const { cloneA, cloneB } = await twoClones(t);
  const a = await makeGitDriver(t, cloneA);
  const b = await makeGitDriver(t, cloneB);
  await a.init();
  await b.init();
  const rootA = (await gitExec(cloneA, ['rev-list', '--max-parents=0', a.ledgerRef])).stdout.trim();
  const rootB = (await gitExec(cloneB, ['rev-list', '--max-parents=0', b.ledgerRef])).stdout.trim();
  assert.equal(rootA, rootB);
  assert.equal(rootA, DETERMINISTIC_ROOT_SHA);
});

test('a first-divergence sync merges -X theirs without unrelated histories', async (t) => {
  const { cloneA, cloneB } = await twoClones(t);
  const a = await makeGitDriver(t, cloneA);
  const b = await makeGitDriver(t, cloneB);
  await a.init();
  await b.init();
  await a.writeThread(makeThread({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', slug: 'from-a' }));
  await a.commit('feat: from A');
  assert.equal((await a.sync()).pushed, true);
  await b.writeThread(makeThread({ id: '01BX5ZZKBKACTAV9WEVGEMMVRZ', slug: 'from-b' }));
  await b.commit('feat: from B');
  const result = await b.sync();
  assert.equal(result.merged, true);
  assert.equal(result.pushed, true);
  const listed = (await b.listThreads()).map((r) => r.slug).sort();
  assert.deepEqual(listed, ['from-a', 'from-b']);
});

test('sync refuses to merge unrelated ledger histories (divergent root)', async (t) => {
  const { repo, remote } = await initGitRepoWithRemote(t);
  const driver = await makeGitDriver(t, repo);
  await driver.init();
  const foreignRoot = (await gitExec(
    repo,
    ['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'unrelated ledger'],
    { env: { GIT_AUTHOR_NAME: 'Z', GIT_AUTHOR_EMAIL: 'z@z', GIT_AUTHOR_DATE: '2021-01-01T00:00:00Z', GIT_COMMITTER_NAME: 'Z', GIT_COMMITTER_EMAIL: 'z@z', GIT_COMMITTER_DATE: '2021-01-01T00:00:00Z' } },
  )).stdout.trim();
  await gitExec(repo, ['push', '-q', remote, `${foreignRoot}:refs/heads/_ledger`]);
  await driver.writeThread(makeThread());
  await driver.commit('feat: local');
  await assert.rejects(() => driver.sync(), /unrelated ledger histories/);
});
