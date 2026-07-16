import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createLedgerServer } from '../../../bin/ledger-server.mjs';

const fakeTools = [
  { name: 'open_thread', description: 'o', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
];

async function connect(t, deps) {
  const server = createLedgerServer(deps);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  t.after(() => client.close());
  return client;
}

test('createLedgerServer serves the injected listTools surface', async (t) => {
  const client = await connect(t, {
    listTools: () => fakeTools,
    buildContext: async () => ({ marker: 'ctx' }),
    callTool: async () => ({ ok: true }),
    env: {},
  });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name), ['open_thread']);
});

test('callTool dispatch passes (name, args, ctx) and wraps the result as JSON content', async (t) => {
  const seen = [];
  const client = await connect(t, {
    listTools: () => fakeTools,
    buildContext: async () => ({ marker: 'ctx' }),
    callTool: async (name, args, ctx) => { seen.push({ name, args, ctx }); return { thread: { id: 'T1' } }; },
    env: {},
  });
  const res = await client.callTool({ name: 'open_thread', arguments: { title: 'X' } });
  assert.deepEqual(seen, [{ name: 'open_thread', args: { title: 'X' }, ctx: { marker: 'ctx' } }]);
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0].text), { thread: { id: 'T1' } });
});

test('buildContext receives the env-derived userConfig (never hardcoded {}) and is built once', async (t) => {
  const configs = [];
  let builds = 0;
  const client = await connect(t, {
    listTools: () => fakeTools,
    buildContext: async (opts) => { builds += 1; configs.push(opts); return { marker: 'ctx' }; },
    callTool: async () => ({ ok: true }),
    env: { LEDGER_BACKEND: 'orphan-branch' },
  });
  await client.callTool({ name: 'open_thread', arguments: {} });
  await client.callTool({ name: 'open_thread', arguments: {} });
  assert.equal(builds, 1);
  assert.deepEqual(configs[0], { userConfig: { ledger_backend: 'orphan-branch' } });
});

test('a thrown tool error is returned as an isError result carrying name+message', async (t) => {
  const client = await connect(t, {
    listTools: () => fakeTools,
    buildContext: async () => ({ marker: 'ctx' }),
    callTool: async () => { const e = new Error('illegal transition active -> active'); e.name = 'ToolError'; throw e; },
    env: {},
  });
  const res = await client.callTool({ name: 'open_thread', arguments: {} });
  assert.equal(res.isError, true);
  assert.deepEqual(JSON.parse(res.content[0].text), { error: 'ToolError', message: 'illegal transition active -> active' });
});
