import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { projectKey } from '../../../src/util/project-key.mjs';

function isGitProject(projectDir) {
  return existsSync(join(projectDir, '.git'));
}

function gitCommonDir(projectDir) {
  const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: projectDir,
    encoding: 'utf8',
  }).trim();
  return resolve(projectDir, out);
}

function ledgerRoot(projectDir, dataDir) {
  const key = projectKey(projectDir);
  return isGitProject(projectDir)
    ? join(dataDir, key, 'ledger-worktree')
    : join(dataDir, key, 'ledger');
}

export async function readActiveThread({ projectDir, dataDir }) {
  const pointerPath = isGitProject(projectDir)
    ? join(gitCommonDir(projectDir), 'ledger', 'active-thread')
    : join(dataDir, projectKey(projectDir), 'active-thread');
  try {
    const raw = await readFile(pointerPath, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function readResumableIndex({ projectDir, dataDir }) {
  const indexPath = join(ledgerRoot(projectDir, dataDir), 'index', 'resumable.json');
  try {
    const raw = await readFile(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}
