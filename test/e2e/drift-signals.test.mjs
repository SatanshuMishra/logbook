import test from 'node:test';
import assert from 'node:assert/strict';
import { startLedger, stopLedger, callTool } from './helpers/harness.mjs';
import { initGitRepo, initGitRepoWithRemote, git, commitFile, tempDir, cleanup } from './helpers/fixtures.mjs';
import { expectSignal, findEntry } from './helpers/signals.mjs';

async function boundReconcile(t, { repo, branch, firstCommit = null, extraEnv }) {
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(dataDir));
  const client = await startLedger({ projectDir: repo, dataDir, extraEnv });
  t.after(() => stopLedger(client));
  const { thread } = await callTool(client, 'open_thread', { title: `Drift ${branch}`, completion_criteria: [{ text: 'ship it' }] });
  await callTool(client, 'bind_branch', {
    thread_id: thread.id,
    repo,
    branch,
    first_commit: firstCommit,
  });
  return callTool(client, 'reconcile', {});
}

test('deleted-unmerged branch classifies branch-gone WARNING', async (t) => {
  const repo = await initGitRepo();
  t.after(() => cleanup(repo));
  await git(repo, ['checkout', '-q', '-b', 'feature']);
  const first = await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['branch', '-q', '-D', 'feature']);

  const { drift, dispositions } = await boundReconcile(t, {
    repo, branch: 'feature', firstCommit: first, extraEnv: { LEDGER_BASE_REF: 'main' },
  });
  const entry = findEntry(drift, 'feature');
  expectSignal(entry, 'branch-gone', 'WARNING');
  assert.equal(entry.classification, 'WARNING');
  assert.equal(dispositions.find((d) => d.binding_id === entry.binding_id).action, 'mark-orphaned');
});

test('merged live branch classifies branch-gone COMPLETE', async (t) => {
  const repo = await initGitRepo();
  t.after(() => cleanup(repo));
  await git(repo, ['checkout', '-q', '-b', 'feature']);
  await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature']);

  const { drift, dispositions } = await boundReconcile(t, {
    repo, branch: 'feature', extraEnv: { LEDGER_BASE_REF: 'main' },
  });
  const entry = findEntry(drift, 'feature');
  const gone = expectSignal(entry, 'branch-gone', 'COMPLETE');
  assert.equal(gone.detail, 'merged');
  assert.equal(entry.classification, 'COMPLETE');
  assert.equal(dispositions.find((d) => d.binding_id === entry.binding_id).action, 'mark-merged');
});

test('merged-then-pruned branch classifies branch-gone COMPLETE via best-effort merged', async (t) => {
  const repo = await initGitRepo();
  t.after(() => cleanup(repo));
  await git(repo, ['checkout', '-q', '-b', 'feature']);
  const first = await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature']);
  await git(repo, ['branch', '-q', '-D', 'feature']);

  const { drift } = await boundReconcile(t, {
    repo, branch: 'feature', firstCommit: first, extraEnv: { LEDGER_BASE_REF: 'main' },
  });
  const entry = findEntry(drift, 'feature');
  const gone = expectSignal(entry, 'branch-gone', 'COMPLETE');
  assert.equal(gone.detail, 'merged');
  assert.equal(entry.classification, 'COMPLETE');
});

test('squash-merged branch classifies the squash-merged SIGNAL COMPLETE (assert at signal level)', async (t) => {
  const repo = await initGitRepo();
  t.after(() => cleanup(repo));
  await git(repo, ['checkout', '-q', '-b', 'feature']);
  await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['merge', '-q', '--squash', 'feature']);
  await git(repo, ['commit', '-q', '--no-verify', '-m', 'squash: feature']);

  const { drift, dispositions } = await boundReconcile(t, {
    repo, branch: 'feature', extraEnv: { LEDGER_BASE_REF: 'main' },
  });
  const entry = findEntry(drift, 'feature');
  expectSignal(entry, 'squash-merged', 'COMPLETE');
  assert.equal(dispositions.find((d) => d.binding_id === entry.binding_id).action, 'mark-merged');
});

test('a live branch whose recorded first_commit was rewritten classifies head-missing CRITICAL', async (t) => {
  const repo = await initGitRepo();
  t.after(() => cleanup(repo));
  await git(repo, ['checkout', '-q', '-b', 'feature']);
  const first = await commitFile(repo, 'feat.txt', 'v1\n', 'feat: v1');
  await git(repo, ['commit', '-q', '--amend', '--no-verify', '-m', 'feat: v1 rewritten']);

  const { drift } = await boundReconcile(t, {
    repo, branch: 'feature', firstCommit: first, extraEnv: { LEDGER_BASE_REF: 'main' },
  });
  const entry = findEntry(drift, 'feature');
  expectSignal(entry, 'head-missing', 'CRITICAL');
  assert.equal(entry.classification, 'CRITICAL');
});

test('a diverged branch classifies divergence + not-ancestor WARNING', async (t) => {
  const { dir: repo, remote } = await initGitRepoWithRemote();
  t.after(() => cleanup(repo, remote));
  await git(repo, ['checkout', '-q', '-b', 'feature']);
  await commitFile(repo, 'a.txt', 'a\n', 'feat: a');
  await git(repo, ['push', '-q', 'origin', 'feature']);
  await git(repo, ['fetch', '-q', 'origin']);
  await git(repo, ['reset', '-q', '--hard', 'main']);
  await commitFile(repo, 'b.txt', 'b\n', 'feat: b');

  const { drift } = await boundReconcile(t, { repo, branch: 'feature' });
  const entry = findEntry(drift, 'feature');
  expectSignal(entry, 'divergence', 'WARNING');
  expectSignal(entry, 'not-ancestor', 'WARNING');
  assert.equal(entry.classification, 'WARNING');
});
