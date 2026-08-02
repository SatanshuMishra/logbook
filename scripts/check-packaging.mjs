#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_FILES = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.mcp.json',
  'package.json',
  'package-lock.json',
  'bin/ledger-server.mjs',
  'bin/ledger-cli.mjs',
  'scripts/check-packaging.mjs',
  'hooks/hooks.json',
  'hooks/commit-msg',
  'hooks/dispatcher',
  'hooks/session-start.mjs',
  'hooks/user-prompt-submit.mjs',
  'hooks/pre-tool-use.mjs',
  'hooks/post-tool-use.mjs',
  'hooks/stop.mjs',
  'hooks/pre-compact.mjs',
  'skills/debrief/SKILL.md',
  'skills/preflight/SKILL.md',
];

export const EXECUTABLE_FILES = [
  'hooks/session-start.mjs',
  'hooks/user-prompt-submit.mjs',
  'hooks/pre-tool-use.mjs',
  'hooks/post-tool-use.mjs',
  'hooks/stop.mjs',
  'hooks/pre-compact.mjs',
  'hooks/commit-msg',
  'hooks/dispatcher',
];

export const EXACT_DEPENDENCIES = {
  '@modelcontextprotocol/sdk': '1.29.0',
  ajv: '8.20.0',
  ulid: '3.0.2',
};

export const SERVER_ENV_KEYS = ['LEDGER_BACKEND', 'LEDGER_BRANCH'];

export const SERVER_ARGS = ['${CLAUDE_PLUGIN_ROOT}/bin/ledger-server.mjs'];

export const FORBIDDEN_SERVER_ENV_KEYS = [
  'LEDGER_DISABLE_TRAILER',
  'LEDGER_NUDGE_FRACTION',
  'LEDGER_NUDGE_BYTES',
];

async function checkRequiredFiles(root, problems) {
  for (const rel of REQUIRED_FILES) {
    try {
      await stat(join(root, rel));
    } catch {
      problems.push(`missing required file: ${rel}`);
    }
  }
}

async function readJsonFile(root, rel, problems) {
  let raw;
  try {
    raw = await readFile(join(root, rel), 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    problems.push(`${rel}: invalid JSON (${err.message})`);
    return null;
  }
}

async function checkPackageManifest(root, problems) {
  const pkg = await readJsonFile(root, 'package.json', problems);
  if (!pkg) return;
  const deps = pkg.dependencies ?? {};
  const names = Object.keys(deps).sort();
  const expected = Object.keys(EXACT_DEPENDENCIES).sort();
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) {
    problems.push(`package.json: dependencies must be exactly ${expected.join(', ')} (found ${names.join(', ') || 'none'})`);
  }
  for (const [name, version] of Object.entries(EXACT_DEPENDENCIES)) {
    const actual = deps[name];
    if (actual === undefined) continue;
    if (!/^\d+\.\d+\.\d+$/.test(actual)) {
      problems.push(`package.json: ${name} must be exact-pinned with no range operator (found "${actual}")`);
    } else if (actual !== version) {
      problems.push(`package.json: ${name} must be pinned to ${version} (found "${actual}")`);
    }
  }
  if ('devDependencies' in pkg) {
    problems.push('package.json: devDependencies must be absent (a fourth dependency or bundler is a packaging failure)');
  }
  const testScript = pkg.scripts?.test ?? '';
  if (!testScript.includes('node --test')) {
    problems.push('package.json: test script must run "node --test"');
  }
  if (testScript.includes('test/unit') !== testScript.includes('test/e2e')) {
    problems.push('package.json: test script lists test/unit or test/e2e but not both (must cover both suites)');
  }
}

async function checkMcpDeclaration(root, problems) {
  const mcp = await readJsonFile(root, '.mcp.json', problems);
  if (!mcp) return;
  const serverKeys = Object.keys(mcp.mcpServers ?? {});
  if (serverKeys.length !== 1 || serverKeys[0] !== 'ledger') {
    problems.push(`.mcp.json: mcpServers must declare exactly one server, "ledger" (found ${serverKeys.join(', ') || 'none'})`);
  }
  const server = mcp.mcpServers?.ledger;
  if (!server) {
    problems.push('.mcp.json: mcpServers.ledger is missing (the mcp__ledger__* surface depends on this key)');
    return;
  }
  if (server.command !== 'node') {
    problems.push(`.mcp.json: ledger server command must be "node" (found ${JSON.stringify(server.command)})`);
  }
  const args = Array.isArray(server.args) ? server.args : [];
  const launchesServer = args.length === SERVER_ARGS.length
    && args.every((a, i) => a === SERVER_ARGS[i]);
  if (!launchesServer) {
    problems.push(`.mcp.json: ledger server args must be exactly ${JSON.stringify(SERVER_ARGS)} (found ${JSON.stringify(server.args)})`);
  }
  const env = server.env ?? {};
  const allowedEnvKeys = new Set(SERVER_ENV_KEYS);
  for (const key of SERVER_ENV_KEYS) {
    if (typeof env[key] !== 'string') {
      problems.push(`.mcp.json: ledger server env must forward ${key} as a string`);
    }
  }
  for (const key of FORBIDDEN_SERVER_ENV_KEYS) {
    if (key in env) {
      problems.push(`.mcp.json: ${key} must be ABSENT from the ledger server env (hook-plane variable)`);
    }
  }
  const unexpectedKeys = Object.keys(env).filter((key) => !allowedEnvKeys.has(key));
  if (unexpectedKeys.length > 0) {
    problems.push(`.mcp.json: ledger server env must contain only ${SERVER_ENV_KEYS.join(', ')} (found unexpected: ${unexpectedKeys.join(', ')})`);
  }
}

async function checkHooksEnv(root, problems) {
  const hooks = await readJsonFile(root, 'hooks/hooks.json', problems);
  if (!hooks) return;
  const env = hooks.env ?? {};
  if (env.LEDGER_DISABLE_TRAILER !== '${user_config.disable_trailer}') {
    problems.push('hooks/hooks.json: env must deliver LEDGER_DISABLE_TRAILER=${user_config.disable_trailer}');
  }
  for (const key of ['LEDGER_NUDGE_FRACTION', 'LEDGER_NUDGE_BYTES']) {
    if (key in env) {
      problems.push(`hooks/hooks.json: ${key} must NOT be in the env block (ambient process.env override, not user_config)`);
    }
  }
}

async function checkExecutableBits(root, problems) {
  for (const rel of EXECUTABLE_FILES) {
    let info;
    try {
      info = await stat(join(root, rel));
    } catch {
      continue;
    }
    if ((info.mode & 0o111) === 0) {
      problems.push(`${rel}: missing executable bit`);
    }
  }
}

async function checkMarketplace(root, problems) {
  const mkt = await readJsonFile(root, '.claude-plugin/marketplace.json', problems);
  if (!mkt) return;
  if (mkt.name !== 'logbook') {
    problems.push(`.claude-plugin/marketplace.json: name must be "logbook" (found ${JSON.stringify(mkt.name)})`);
  }
  if (!mkt.owner || typeof mkt.owner.name !== 'string' || mkt.owner.name.length === 0) {
    problems.push('.claude-plugin/marketplace.json: owner.name is required');
  }
  const entry = Array.isArray(mkt.plugins) ? mkt.plugins[0] : undefined;
  if (!entry) {
    problems.push('.claude-plugin/marketplace.json: plugins[0] is missing');
    return;
  }
  if (entry.name !== 'logbook') {
    problems.push(`.claude-plugin/marketplace.json: plugins[0].name must be "logbook" (found ${JSON.stringify(entry.name)})`);
  }
  if (entry.source !== './') {
    problems.push(`.claude-plugin/marketplace.json: plugins[0].source must be "./" (found ${JSON.stringify(entry.source)})`);
  }
}

export async function checkPackaging(root) {
  const problems = [];
  await checkRequiredFiles(root, problems);
  await checkPackageManifest(root, problems);
  await checkMcpDeclaration(root, problems);
  await checkHooksEnv(root, problems);
  await checkExecutableBits(root, problems);
  await checkMarketplace(root, problems);
  return { ok: problems.length === 0, problems };
}

async function main(argv) {
  const rootArg = argv[2];
  const root = rootArg
    ? resolve(rootArg)
    : resolve(fileURLToPath(new URL('..', import.meta.url)));
  const { ok, problems } = await checkPackaging(root);
  if (ok) {
    process.stdout.write('check-packaging: ok\n');
    return 0;
  }
  process.stderr.write(`check-packaging: ${problems.length} problem(s) found\n`);
  for (const problem of problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`check-packaging: fatal ${err.stack || err}\n`);
      process.exit(2);
    });
}
