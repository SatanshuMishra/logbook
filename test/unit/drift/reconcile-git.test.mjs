import test from 'node:test';
import assert from 'node:assert/strict';
import { runReconcile } from '../../../src/drift/reconcile.mjs';
import { newBinding } from '../../../src/model/index.mjs';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { commitFile, initGitRepo, makeGitDriver } from '../../fixtures/git-repos.mjs';

const THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const REPO_LABEL = 'acme/app';
const NOW = '2026-07-15T12:00:00Z';

function boundThread() {
  return {
    schema_version: 2,
    id: THREAD_ID,
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
  };
}

async function ledgerBoundToDeletedBranch(t) {
  const repo = await initGitRepo(t);
  await commitFile(repo, 'base.txt', 'base\n', 'chore: base');
  await gitExec(repo, ['checkout', '-q', '-b', 'feature']);
  const firstCommit = await commitFile(repo, 'feat.txt', 'feat\n', 'feat: work');
  await gitExec(repo, ['checkout', '-q', 'main']);
  await gitExec(repo, ['branch', '-q', '-D', 'feature']);
  process.env.LEDGER_BASE_REF = 'main';
  t.after(() => { delete process.env.LEDGER_BASE_REF; });

  const driver = await makeGitDriver(t, repo);
  await driver.init();
  await driver.writeThread(boundThread());
  await driver.writeBinding(newBinding(
    { thread_id: THREAD_ID, repo: REPO_LABEL, branch: 'feature', first_commit: firstCommit },
    { now: () => NOW },
  ));
  return driver;
}

test('reconcile completes for an active binding whose repo is an identifier rather than a path', async (t) => {
  const driver = await ledgerBoundToDeletedBranch(t);

  const result = await runReconcile({ driver, now: () => NOW });

  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].repo, REPO_LABEL);
  assert.equal(result.drift[0].branch, 'feature');
  assert.equal(result.drift[0].classification, 'WARNING');
  assert.equal(result.dispositions.length, 1);
  assert.equal(result.dispositions[0].action, 'mark-orphaned');
  const stored = (await driver.listBindings()).find((b) => b.branch === 'feature');
  assert.equal(stored.status, 'orphaned');
});
