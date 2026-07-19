import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');
const pluginPath = join(repoRoot, '.claude-plugin', 'plugin.json');

function loadJson(path, label) {
  assert.ok(existsSync(path), `${label} must exist at ${path}`);
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    assert.fail(`${label} is not valid JSON: ${err.message}`);
  }
}

test('marketplace.json pins the continuity-ledger marketplace identity', () => {
  const manifest = loadJson(marketplacePath, 'marketplace.json');
  assert.equal(manifest.name, 'continuity-ledger');
  assert.equal(typeof manifest.owner, 'object');
  assert.notEqual(manifest.owner, null);
  assert.equal(manifest.owner.name, 'SatanshuMishra');
});

test('the single plugin entry points the marketplace root at the plugin root', () => {
  const manifest = loadJson(marketplacePath, 'marketplace.json');
  assert.ok(Array.isArray(manifest.plugins));
  assert.equal(manifest.plugins.length, 1);
  const entry = manifest.plugins[0];
  assert.equal(entry.name, 'session-continuity');
  assert.equal(entry.source, './');
});

test('strict defaults to true so plugin.json stays authoritative', () => {
  const manifest = loadJson(marketplacePath, 'marketplace.json');
  const entry = manifest.plugins[0];
  assert.notEqual(entry.strict, false);
});

test('the plugin entry name agrees with plugin.json (packaging-manifests dependency)', () => {
  const manifest = loadJson(marketplacePath, 'marketplace.json');
  const plugin = loadJson(pluginPath, 'plugin.json');
  assert.equal(plugin.name, 'session-continuity');
  assert.equal(manifest.plugins[0].name, plugin.name);
});
