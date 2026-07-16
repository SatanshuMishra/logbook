import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createLedgerServer, main } from '../../../bin/ledger-server.mjs';

function withEnv(t, patch) {
  const prev = {};
  for (const key of Object.keys(patch)) prev[key] = process.env[key];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function liveServer(t) {
  const projectDir = await mkdtemp(join(tmpdir(), 'srv-proj-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'srv-data-'));
  withEnv(t, {
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_PLUGIN_DATA: dataDir,
    LEDGER_BACKEND: undefined,
    LEDGER_BRANCH: undefined,
  });
  t.after(async () => {
    await rm(projectDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });
  const server = createLedgerServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  t.after(() => client.close());
  return client;
}

test('main is exported and importing the module does not connect a transport', () => {
  assert.equal(typeof main, 'function');
});

test('the server identifies as "ledger" so the mcp__ledger__* surface resolves', async (t) => {
  const client = await liveServer(t);
  assert.equal(client.getServerVersion().name, 'ledger');
});

test('listTools exposes the frozen 12-tool surface (no restore) through the live server', async (t) => {
  const client = await liveServer(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 12);
  const names = tools.map((x) => x.name).sort();
  assert.deepEqual(names, [
    'append_session_event', 'archive_thread', 'bind_branch', 'create_successor',
    'get_resume_brief', 'open_thread', 'rebuild_index', 'reconcile',
    'record_decision', 'reopen', 'transition_thread', 'update_thread',
  ]);
  assert.equal(names.includes('restore'), false);
});

test('a real open_thread call flows through buildContext into the live tool layer', async (t) => {
  const client = await liveServer(t);
  const res = await client.callTool({ name: 'open_thread', arguments: { title: 'Via Server' } });
  assert.equal(res.isError, undefined);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.thread.status, 'active');
  assert.equal(payload.thread.slug, 'via-server');
});
