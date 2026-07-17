import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readManifest() {
  const raw = await readFile(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

test('plugin.json parses and carries the exact metadata contract', async () => {
  const m = await readManifest();
  assert.equal(m.name, 'session-continuity');
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.equal(m.displayName, 'Session Continuity');
  assert.equal(m.author.name, 'Session Continuity Plugin');
  assert.equal(m.license, 'MIT');
  assert.equal(typeof m.description, 'string');
  assert.ok(m.description.length > 0);
  assert.deepEqual(m.keywords, ['session-continuity', 'ledger', 'mcp', 'handoff', 'resume', 'drift']);
});

test('userConfig declares EXACTLY the three keys and never ledger_remote', async () => {
  const m = await readManifest();
  assert.deepEqual(Object.keys(m.userConfig).sort(), ['disable_trailer', 'ledger_backend', 'ledger_branch']);
  assert.equal('ledger_remote' in m.userConfig, false);
});

test('each userConfig key declares type, title, description and the exact default', async () => {
  const m = await readManifest();

  const backend = m.userConfig.ledger_backend;
  assert.equal(backend.type, 'string');
  assert.equal(backend.default, 'orphan-branch');
  assert.ok(backend.title && backend.description);

  const branch = m.userConfig.ledger_branch;
  assert.equal(branch.type, 'string');
  assert.equal(branch.default, '_ledger');
  assert.ok(branch.title && branch.description);

  const trailer = m.userConfig.disable_trailer;
  assert.equal(trailer.type, 'boolean');
  assert.equal(trailer.default, false);
  assert.ok(trailer.title && trailer.description);
});
