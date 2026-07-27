import { resolve } from 'node:path';
import { gitExec } from '../../src/util/git-exec.mjs';
import { clearedGitLocationEnv } from '../../src/util/git-env.mjs';

function discoveryOptions() {
  return { env: clearedGitLocationEnv(), check: false };
}

export async function isGitWorkTree(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return false;
  }
  try {
    const { code, stdout } = await gitExec(dir, ['rev-parse', '--is-inside-work-tree'], discoveryOptions());
    return code === 0 && stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function gitCommonDir(dir) {
  try {
    const { code, stdout } = await gitExec(dir, ['rev-parse', '--git-common-dir'], discoveryOptions());
    return code === 0 ? resolve(dir, stdout.trim()) : null;
  } catch {
    return null;
  }
}

export async function headSha(dir) {
  try {
    const { code, stdout } = await gitExec(dir, ['rev-parse', 'HEAD'], discoveryOptions());
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}
