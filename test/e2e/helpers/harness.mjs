import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const PLUGIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SERVER_PATH = fileURLToPath(new URL('../../../bin/ledger-server.mjs', import.meta.url));

export async function startLedger({ projectDir, dataDir, backend, branch, extraEnv = {} }) {
  if (typeof projectDir !== 'string' || projectDir.length === 0) {
    throw new Error('startLedger: projectDir is required');
  }
  if (typeof dataDir !== 'string' || dataDir.length === 0) {
    throw new Error('startLedger: dataDir is required');
  }
  const env = {
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_PLUGIN_DATA: dataDir,
    ...(backend ? { LEDGER_BACKEND: backend } : {}),
    ...(branch ? { LEDGER_BRANCH: branch } : {}),
    ...extraEnv,
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'e2e', version: '0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

export async function stopLedger(client) {
  if (client) await client.close();
}

export async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res && res.content && res.content[0] ? res.content[0].text : '';
  assert.notEqual(res.isError, true, `tool ${name} unexpectedly refused: ${text}`);
  return JSON.parse(text);
}

export async function expectToolError(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  assert.equal(res.isError, true, `expected tool ${name} to refuse, but it succeeded`);
  assert.equal(res.content.length, 2, `tool ${name} refused without a structured record`);
  return JSON.parse(res.content[1].text);
}
