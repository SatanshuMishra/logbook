import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkPackaging, REQUIRED_FILES } from '../../../scripts/check-packaging.mjs';

async function writeFileEnsuringDir(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function writeValidEnsemble(root) {
  const files = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'session-continuity', version: '0.1.0' }),
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'continuity-ledger',
      owner: { name: 'SatanshuMishra' },
      plugins: [{ name: 'session-continuity', source: './' }],
    }),
    '.mcp.json': JSON.stringify({
      mcpServers: {
        ledger: {
          command: 'node',
          args: ['${CLAUDE_PLUGIN_ROOT}/bin/ledger-server.mjs'],
          env: {
            LEDGER_BACKEND: '${user_config.ledger_backend}',
            LEDGER_BRANCH: '${user_config.ledger_branch}',
          },
        },
      },
    }),
    'package.json': JSON.stringify({
      type: 'module',
      engines: { node: '>=20' },
      scripts: { test: 'node --test' },
      dependencies: {
        '@modelcontextprotocol/sdk': '1.29.0',
        ajv: '8.20.0',
        ulid: '3.0.2',
      },
    }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3 }),
    'bin/ledger-server.mjs': '',
    'bin/ledger-cli.mjs': '',
    'scripts/check-packaging.mjs': '',
    'hooks/hooks.json': JSON.stringify({
      hooks: {},
      env: { LEDGER_DISABLE_TRAILER: '${user_config.disable_trailer}' },
    }),
    'hooks/commit-msg': '#!/usr/bin/env node\n',
    'hooks/dispatcher': '#!/usr/bin/env node\n',
    'hooks/session-start.mjs': '',
    'hooks/user-prompt-submit.mjs': '',
    'hooks/pre-tool-use.mjs': '',
    'hooks/post-tool-use.mjs': '',
    'hooks/stop.mjs': '',
    'hooks/pre-compact.mjs': '',
    'skills/session-handoff/SKILL.md': '# session-handoff\n',
    'skills/resume-project/SKILL.md': '# resume-project\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    await writeFileEnsuringDir(join(root, rel), content);
  }
  const executables = [
    'hooks/session-start.mjs', 'hooks/user-prompt-submit.mjs', 'hooks/pre-tool-use.mjs',
    'hooks/post-tool-use.mjs', 'hooks/stop.mjs', 'hooks/pre-compact.mjs',
    'hooks/commit-msg', 'hooks/dispatcher',
  ];
  for (const rel of executables) {
    await chmod(join(root, rel), 0o755);
  }
}

export async function freshEnsemble(t) {
  const root = await mkdtemp(join(tmpdir(), 'pkg-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeValidEnsemble(root);
  return root;
}

export async function rewriteJson(root, rel, next) {
  await writeFile(join(root, rel), JSON.stringify(next));
}

export async function readEnsembleJson(root, rel) {
  return JSON.parse(await readFile(join(root, rel), 'utf8'));
}

test('a complete valid ensemble passes with zero problems', async (t) => {
  const root = await freshEnsemble(t);
  const result = await checkPackaging(root);
  assert.equal(result.ok, true, result.problems.join('; '));
  assert.deepEqual(result.problems, []);
});

test('a missing required file is reported precisely', async (t) => {
  const root = await freshEnsemble(t);
  await rm(join(root, 'bin/ledger-cli.mjs'));
  const { ok, problems } = await checkPackaging(root);
  assert.equal(ok, false);
  assert.ok(problems.some((p) => p.includes('bin/ledger-cli.mjs')), problems.join('; '));
});

test('every REQUIRED_FILES entry is individually enforced', async (t) => {
  for (const rel of REQUIRED_FILES) {
    const root = await mkdtemp(join(tmpdir(), 'pkg-guard-'));
    try {
      await writeValidEnsemble(root);
      await rm(join(root, rel), { recursive: true, force: true });
      const { ok, problems } = await checkPackaging(root);
      assert.equal(ok, false, `deleting ${rel} must fail the guard`);
      assert.ok(problems.some((p) => p.includes(rel)), `a problem must name ${rel}: ${problems.join('; ')}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
