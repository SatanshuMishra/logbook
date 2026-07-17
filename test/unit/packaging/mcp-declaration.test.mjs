import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readMcp() {
  const raw = await readFile(new URL('../../../.mcp.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

test('.mcp.json declares the ledger stdio server launched via node', async () => {
  const cfg = await readMcp();
  const server = cfg.mcpServers.ledger;
  assert.ok(server, 'server key MUST be "ledger"');
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['${CLAUDE_PLUGIN_ROOT}/bin/ledger-server.mjs']);
});

test('the server env forwards EXACTLY the two driver vars from user_config', async () => {
  const cfg = await readMcp();
  const env = cfg.mcpServers.ledger.env;
  assert.deepEqual(Object.keys(env).sort(), ['LEDGER_BACKEND', 'LEDGER_BRANCH']);
  assert.equal(env.LEDGER_BACKEND, '${user_config.ledger_backend}');
  assert.equal(env.LEDGER_BRANCH, '${user_config.ledger_branch}');
});

test('all three hook-plane vars are ABSENT from the server env', async () => {
  const cfg = await readMcp();
  const env = cfg.mcpServers.ledger.env;
  for (const forbidden of ['LEDGER_DISABLE_TRAILER', 'LEDGER_NUDGE_FRACTION', 'LEDGER_NUDGE_BYTES']) {
    assert.equal(forbidden in env, false, `${forbidden} must not reach the server`);
  }
});
