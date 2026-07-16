import { resolve } from 'node:path';
import { gitExec } from '../../src/util/git-exec.mjs';

export async function isGitWorkTree(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return false;
  }
  try {
    const { code, stdout } = await gitExec(dir, ['rev-parse', '--is-inside-work-tree'], { check: false });
    return code === 0 && stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function gitCommonDir(dir) {
  try {
    const { code, stdout } = await gitExec(dir, ['rev-parse', '--git-common-dir'], { check: false });
    return code === 0 ? resolve(dir, stdout.trim()) : null;
  } catch {
    return null;
  }
}

export async function headSha(dir) {
  try {
    const { code, stdout } = await gitExec(dir, ['rev-parse', 'HEAD'], { check: false });
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}
