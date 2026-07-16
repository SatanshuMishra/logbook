import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, copyFile, chmod } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ledgerCliPath, invokeCli, invokeCliJson } from '../../../hooks/lib/cli.mjs';
import { tempDir, cleanup } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = resolve(HERE, 'fixtures', 'fake-cli.mjs');

async function fakeRoot(t) {
  const root = await tempDir('hooks-cli-root-');
  cleanup(t, root);
  await mkdir(join(root, 'bin'), { recursive: true });
  const dest = join(root, 'bin', 'ledger-cli.mjs');
  await copyFile(FAKE_CLI, dest);
  await chmod(dest, 0o755);
  return root;
}

test('ledgerCliPath returns null when CLAUDE_PLUGIN_ROOT is unset', () => {
  assert.equal(ledgerCliPath({}), null);
});

test('ledgerCliPath resolves bin/ledger-cli.mjs under the plugin root', () => {
  assert.equal(ledgerCliPath({ CLAUDE_PLUGIN_ROOT: '/root' }), join('/root', 'bin', 'ledger-cli.mjs'));
});

test('invokeCliJson parses the CLI JSON stdout', async (t) => {
  const root = await fakeRoot(t);
  const out = await invokeCliJson(['roster'], { env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(Array.isArray(out), true);
  assert.equal(out[0].status, 'active');
});

test('invokeCliJson returns null on a non-zero CLI exit (fail-open)', async (t) => {
  const root = await fakeRoot(t);
  assert.equal(await invokeCliJson(['boom'], { env: { CLAUDE_PLUGIN_ROOT: root } }), null);
});

test('invokeCliJson returns null on unparseable CLI output', async (t) => {
  const root = await fakeRoot(t);
  assert.equal(await invokeCliJson(['notjson'], { env: { CLAUDE_PLUGIN_ROOT: root } }), null);
});

test('invokeCli resolves a failure sentinel when CLAUDE_PLUGIN_ROOT is unset', async () => {
  const res = await invokeCli(['roster'], { env: {} });
  assert.equal(res.code, -1);
});
