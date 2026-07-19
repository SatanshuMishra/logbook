import test from 'node:test';
import assert from 'node:assert/strict';
import { startLedger, stopLedger, callTool } from './helpers/harness.mjs';
import { initGitRepo, initNonGitDir, tempDir, cleanup } from './helpers/fixtures.mjs';
import { readActiveThread, readResumableIndex } from './helpers/readers.mjs';

test('harness drives the real server over stdio on a non-git project', async (t) => {
  const projectDir = await initNonGitDir();
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(projectDir, dataDir));
  const client = await startLedger({ projectDir, dataDir });
  t.after(() => stopLedger(client));

  const { thread } = await callTool(client, 'open_thread', { title: 'Smoke Non Git' });
  assert.equal(thread.status, 'active');
  assert.equal(thread.slug, 'smoke-non-git');

  const pointer = await readActiveThread({ projectDir, dataDir });
  assert.equal(pointer, thread.id);

  const { counts } = await callTool(client, 'rebuild_index', {});
  assert.equal(counts.resumable, 1);
  const roster = await readResumableIndex({ projectDir, dataDir });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, thread.id);
});

test('harness drives the real server over stdio on a git project', async (t) => {
  const projectDir = await initGitRepo();
  const dataDir = await tempDir('e2e-data-');
  t.after(() => cleanup(projectDir, dataDir));
  const client = await startLedger({ projectDir, dataDir });
  t.after(() => stopLedger(client));

  const { thread } = await callTool(client, 'open_thread', { title: 'Smoke Git' });
  assert.equal(thread.status, 'active');

  const pointer = await readActiveThread({ projectDir, dataDir });
  assert.equal(pointer, thread.id);

  await callTool(client, 'rebuild_index', {});
  const roster = await readResumableIndex({ projectDir, dataDir });
  assert.equal(roster.some((r) => r.id === thread.id), true);
});
