import test from 'node:test';
import assert from 'node:assert/strict';
import { startLedger, stopLedger, callTool } from './helpers/harness.mjs';
import { initGitRepo, git, commitFile, tempDir, cleanup } from './helpers/fixtures.mjs';

test('reconcile re-attaches by trailer and by slug and leaves an unmatched branch alone', async (t) => {
  const repo = await initGitRepo();
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(repo, dataDir));
  const client = await startLedger({ projectDir: repo, dataDir, extraEnv: { LEDGER_BASE_REF: 'main' } });
  t.after(() => stopLedger(client));

  const seedThread = (await callTool(client, 'open_thread', { title: 'Seed Keepalive', completion_criteria: [{ text: 'ship it' }] })).thread;
  await callTool(client, 'bind_branch', { thread_id: seedThread.id, repo, branch: 'main' });

  const trailerThread = (await callTool(client, 'open_thread', { title: 'Trailer Thread', completion_criteria: [{ text: 'ship it' }] })).thread;
  const slugThread = (await callTool(client, 'open_thread', { title: 'Slug Thread', slug: 'fix-signup-bug', completion_criteria: [{ text: 'ship it' }] })).thread;

  await git(repo, ['checkout', '-q', '-b', 'feat/trailer']);
  await git(repo, [
    'commit', '-q', '--allow-empty', '--no-verify',
    '-m', `feat: trailer work\n\nThread-Id: ${trailerThread.id}`,
  ]);
  await git(repo, ['checkout', '-q', 'main']);

  await git(repo, ['checkout', '-q', '-b', 'fix/signup-bug']);
  await commitFile(repo, 'signup.txt', 'signup\n', 'fix: signup');
  await git(repo, ['checkout', '-q', 'main']);

  await git(repo, ['checkout', '-q', '-b', 'wild/unmatched']);
  await commitFile(repo, 'wild.txt', 'wild\n', 'chore: wild');
  await git(repo, ['checkout', '-q', 'main']);

  const { dispositions } = await callTool(client, 'reconcile', {});
  const reattaches = dispositions.filter((d) => d.kind === 'reattach');

  const trailerRe = reattaches.find((d) => d.branch === 'feat/trailer');
  assert.ok(trailerRe, 'the trailer branch re-attached');
  assert.equal(trailerRe.method, 'trailer');
  assert.equal(trailerRe.thread_id, trailerThread.id);

  const slugRe = reattaches.find((d) => d.branch === 'fix/signup-bug');
  assert.ok(slugRe, 'the slug branch re-attached');
  assert.equal(slugRe.method, 'slug');
  assert.equal(slugRe.thread_id, slugThread.id);

  assert.equal(
    reattaches.some((d) => d.branch === 'wild/unmatched'),
    false,
    'the unmatched branch is left alone (no disposition)',
  );

  await git(repo, ['branch', '-q', '-D', 'feat/trailer']);
  const { brief } = await callTool(client, 'get_resume_brief', { thread_id: trailerThread.id });
  assert.equal(brief.thread_id, trailerThread.id);
});
