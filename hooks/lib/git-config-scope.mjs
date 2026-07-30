import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { gitExec } from '../../src/util/git-exec.mjs';
import { clearedGitLocationEnv, isolatedGitConfigEnv } from '../../src/util/git-env.mjs';

const FILE_ORIGIN_PREFIX = 'file:';

export const WRITABLE_SCOPE_FLAG = Object.freeze({ local: '--local', worktree: '--worktree' });

export function repoExec(repoDir, args, options = {}) {
  return gitExec(repoDir, args, {
    ...options,
    env: { ...clearedGitLocationEnv(), ...isolatedGitConfigEnv() },
  });
}

export function persistentScopeExec(repoDir, args) {
  return gitExec(repoDir, args, { check: false, env: clearedGitLocationEnv() });
}

export function trimTrailingNewline(value) {
  return String(value ?? '').replace(/\r?\n$/, '');
}

export async function readConfig(repoDir, key) {
  const { code, stdout } = await repoExec(repoDir, ['config', '--local', '--get', key], { check: false });
  return code === 0 ? trimTrailingNewline(stdout) : null;
}

export async function realDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return null;
  }
  try {
    return await realpath(dir);
  } catch {
    return null;
  }
}

export async function physicalPath(candidate) {
  const direct = await realDir(candidate);
  if (direct !== null) {
    return direct;
  }
  const parent = await realDir(dirname(candidate));
  return parent === null ? resolve(candidate) : join(parent, basename(candidate));
}

export function contains(ancestor, descendant) {
  const rel = relative(ancestor, descendant);
  if (rel.length === 0) {
    return true;
  }
  if (isAbsolute(rel)) {
    return false;
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

export async function workTreeTop(repoDir) {
  const { code, stdout } = await repoExec(repoDir, ['rev-parse', '--show-toplevel'], { check: false });
  const top = trimTrailingNewline(stdout);
  return code === 0 && top.length > 0 ? top : null;
}

export async function isInsideWorkTree(repoDir, candidate) {
  const top = await workTreeTop(repoDir);
  if (top === null) {
    return false;
  }
  const [topPhysical, candidatePhysical] = await Promise.all([
    physicalPath(top),
    physicalPath(candidate),
  ]);
  return contains(topPhysical, candidatePhysical);
}

async function absoluteGitDir(repoDir) {
  const { code, stdout } = await repoExec(repoDir, ['rev-parse', '--absolute-git-dir'], { check: false });
  const gitDir = trimTrailingNewline(stdout);
  return code === 0 && gitDir.length > 0 ? gitDir : null;
}

export function splitNulRecords(stdout) {
  const records = String(stdout ?? '').split('\0');
  return records[records.length - 1] === '' ? records.slice(0, -1) : records;
}

export async function readOriginValuePairs(repoDir, key) {
  const { code, stdout } = await persistentScopeExec(
    repoDir,
    ['config', '-z', '--get-all', '--show-origin', key],
  );
  if (code !== 0) {
    return [];
  }
  const records = splitNulRecords(stdout);
  const pairs = [];
  for (let index = 0; index + 1 < records.length; index += 2) {
    pairs.push({ origin: records[index], value: records[index + 1] });
  }
  return pairs;
}

export async function originScope(repoDir, origin) {
  if (typeof origin !== 'string' || origin.length === 0) {
    return null;
  }
  if (!origin.startsWith(FILE_ORIGIN_PREFIX)) {
    return 'inherited';
  }
  const gitDir = await absoluteGitDir(repoDir);
  if (gitDir === null) {
    return 'inherited';
  }
  const [originFile, worktreeFile, localFile] = await Promise.all([
    physicalPath(resolve(repoDir, origin.slice(FILE_ORIGIN_PREFIX.length))),
    physicalPath(join(gitDir, 'config.worktree')),
    physicalPath(join(gitDir, 'config')),
  ]);
  if (originFile === worktreeFile) {
    return 'worktree';
  }
  return originFile === localFile ? 'local' : 'inherited';
}
