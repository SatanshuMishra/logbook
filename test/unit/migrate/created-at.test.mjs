import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCreatedAt,
  earliestSessionDate,
  earliestDecisionDate,
  gitFirstCommitDate,
} from '../../../src/migrate/created-at.mjs';

test('rung 1 uses the git first-commit date when present', async () => {
  const r = await deriveCreatedAt({
    gitDate: '2026-06-01T09:00:00Z',
    sessions: [{ date: '2026-06-05' }],
    decisions: [{ date: '2026-06-03' }],
    updated: '2026-06-10',
  });
  assert.deepEqual(r, { created_at: '2026-06-01T09:00:00Z', rung: 1 });
});

test('rung 2 falls back to the earliest session date', async () => {
  const r = await deriveCreatedAt({
    gitDate: null,
    sessions: [{ date: '2026-06-05' }, { date: '2026-06-02' }],
    decisions: [{ date: '2026-06-03' }],
    updated: '2026-06-10',
  });
  assert.deepEqual(r, { created_at: '2026-06-02T00:00:00Z', rung: 2 });
});

test('rung 3 falls back to the earliest decision date', async () => {
  const r = await deriveCreatedAt({
    gitDate: null,
    sessions: [],
    decisions: [{ date: '2026-06-03' }],
    updated: '2026-06-10',
  });
  assert.deepEqual(r, { created_at: '2026-06-03T00:00:00Z', rung: 3 });
});

test('rung 4 falls back to the updated field', async () => {
  const r = await deriveCreatedAt({
    gitDate: null,
    sessions: [],
    decisions: [],
    updated: '2026-06-10',
  });
  assert.deepEqual(r, { created_at: '2026-06-10T00:00:00Z', rung: 4 });
});

test('rung 4 passes a full ISO updated timestamp through unchanged', async () => {
  const r = await deriveCreatedAt({
    gitDate: null,
    sessions: [],
    decisions: [],
    updated: '2026-06-10T14:30:00Z',
  });
  assert.deepEqual(r, { created_at: '2026-06-10T14:30:00Z', rung: 4 });
});

test('exhausting all rungs throws', async () => {
  await assert.rejects(
    () => deriveCreatedAt({ gitDate: null, sessions: [], decisions: [], updated: null }),
    /derivation exhausted/,
  );
});

test('earliestSessionDate returns null for no sessions', () => {
  assert.equal(earliestSessionDate([]), null);
});

test('earliestDecisionDate returns the lexical-min date widened to an ISO instant', () => {
  assert.equal(
    earliestDecisionDate([{ date: '2026-06-05' }, { date: '2026-06-02' }]),
    '2026-06-02T00:00:00Z',
  );
  assert.equal(earliestDecisionDate([]), null);
});

test('gitFirstCommitDate returns the first non-blank author-date line, trimmed', async () => {
  const git = async () => '\n  2026-06-01T09:00:00Z  \n2026-06-02T09:00:00Z\n';
  const r = await gitFirstCommitDate(git, '/repo', 'threads/foo.md');
  assert.equal(r, '2026-06-01T09:00:00Z');
});

test('gitFirstCommitDate resolves to null when the injected git rejects (expected miss)', async () => {
  const git = async () => {
    throw new Error('fatal: not a git repository');
  };
  const r = await gitFirstCommitDate(git, '/repo', 'threads/foo.md');
  assert.equal(r, null);
});

test('gitFirstCommitDate throws when the resolver violates the string contract', async () => {
  const git = async () => 42;
  await assert.rejects(
    () => gitFirstCommitDate(git, '/repo', 'threads/foo.md'),
    /stdout string/,
  );
});
