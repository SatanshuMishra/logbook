import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const EXACT_DEPS = {
  '@modelcontextprotocol/sdk': '1.29.0',
  ajv: '8.20.0',
  ulid: '3.0.2',
};

async function readJson(relative) {
  const raw = await readFile(new URL(relative, import.meta.url), 'utf8');
  return JSON.parse(raw);
}

async function readText(relative) {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

test('package.json declares ESM, the >=20 engine floor, and no build/dev tooling', async () => {
  const pkg = await readJson('../../../package.json');
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.engines && typeof pkg.engines.node === 'string');
  const floor = Number((pkg.engines.node.match(/\d+/) || [])[0]);
  assert.ok(floor >= 20, `engines.node must satisfy >=20, got ${pkg.engines.node}`);
  assert.equal('devDependencies' in pkg, false);
  assert.equal('exports' in pkg, false);
});

test('dependencies are EXACTLY the three, each exact-pinned', async () => {
  const pkg = await readJson('../../../package.json');
  assert.deepEqual(pkg.dependencies, EXACT_DEPS);
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be exact-pinned (no ^/~)`);
  }
});

test('the test script runs node --test and never omits test/e2e when listing paths', async () => {
  const pkg = await readJson('../../../package.json');
  const script = pkg.scripts.test;
  assert.ok(script.includes('node --test'), 'test script must run node --test');
  assert.equal(script.includes('test/unit'), script.includes('test/e2e'),
    'if explicit paths are listed, both test/unit and test/e2e must be present');
});

test('package.json, the plugin manifest and the served version never drift apart', async () => {
  const pkg = await readJson('../../../package.json');
  const plugin = await readJson('../../../.claude-plugin/plugin.json');
  const { SERVER_INFO } = await import('../../../bin/ledger-server.mjs');

  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.version, pkg.version, 'the plugin manifest must ship the packaged version');
  assert.equal(
    SERVER_INFO.version,
    pkg.version,
    'clients read SERVER_INFO.version at initialize; a stale literal misreports the server',
  );
});

test('package-lock.json pins exactly the three root deps at exact versions', async () => {
  const lock = await readJson('../../../package-lock.json');
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[''].dependencies, EXACT_DEPS);
  assert.equal('devDependencies' in lock.packages[''], false);
});

test('.gitignore no longer ignores node_modules but retains the *.tmp-* ignore', async () => {
  const ignore = await readText('../../../.gitignore');
  const lines = ignore.split(/\r?\n/).map((line) => line.trim());
  assert.equal(lines.includes('node_modules/'), false);
  assert.equal(lines.includes('node_modules'), false);
  assert.ok(lines.includes('*.tmp-*'), '.gitignore must retain the *.tmp-* ignore');
});
