#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

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
  'skills/session-handoff/SKILL.md',
  'skills/resume-project/SKILL.md',
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

export async function checkPackaging(root) {
  const problems = [];
  await checkRequiredFiles(root, problems);
  return { ok: problems.length === 0, problems };
}
