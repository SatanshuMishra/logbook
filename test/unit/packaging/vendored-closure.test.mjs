import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const RESOLVE_SCRIPT = [
  "import { Server } from '@modelcontextprotocol/sdk/server/index.js';",
  "import Ajv from 'ajv';",
  "import { ulid } from 'ulid';",
  "process.stdout.write(JSON.stringify({ sdk: typeof Server, ajv: typeof Ajv, ulidLen: ulid().length }));",
].join('\n');

test('the three bare imports resolve from the vendored tree in a scrubbed environment', () => {
  const env = { ...process.env };
  delete env.NODE_PATH;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', RESOLVE_SCRIPT], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.sdk, 'function');
  assert.equal(parsed.ajv, 'function');
  assert.equal(parsed.ulidLen, 26);
});

test('each pinned dependency is materialized at its exact version', async () => {
  const pins = { '@modelcontextprotocol/sdk': '1.29.0', ajv: '8.20.0', ulid: '3.0.2' };
  for (const [name, version] of Object.entries(pins)) {
    const raw = await readFile(join(repoRoot, 'node_modules', name, 'package.json'), 'utf8');
    assert.equal(JSON.parse(raw).version, version, `${name} must be vendored at ${version}`);
  }
});

test('no native addons are vendored (pure-JS closure, portable across platforms)', async () => {
  const offenders = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.node')) {
        offenders.push(full);
      }
    }
  }
  await walk(join(repoRoot, 'node_modules'));
  assert.deepEqual(offenders, [], `native addons found: ${offenders.join(', ')}`);
});

test('the vendored tree matches the lockfile production closure (no extraneous packages)', async () => {
  const lock = JSON.parse(await readFile(join(repoRoot, 'package-lock.json'), 'utf8'));
  const expected = new Set(
    Object.entries(lock.packages)
      .filter(([key, meta]) => /^node_modules\/(@[^/]+\/[^/]+|[^/]+)$/.test(key) && !meta.dev)
      .map(([key]) => key.slice('node_modules/'.length)),
  );

  const actual = new Set();
  const top = await readdir(join(repoRoot, 'node_modules'), { withFileTypes: true });
  for (const entry of top) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scoped = await readdir(join(repoRoot, 'node_modules', entry.name), { withFileTypes: true });
      for (const inner of scoped) {
        if (inner.isDirectory() && !inner.name.startsWith('.')) actual.add(`${entry.name}/${inner.name}`);
      }
    } else {
      actual.add(entry.name);
    }
  }

  const extraneous = [...actual].filter((name) => !expected.has(name)).sort();
  const missing = [...expected].filter((name) => !actual.has(name)).sort();
  assert.deepEqual(extraneous, [], `extraneous packages absent from the lockfile: ${extraneous.join(', ')}`);
  assert.deepEqual(missing, [], `lockfile packages missing from the vendored tree: ${missing.join(', ')}`);
});
