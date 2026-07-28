import { realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { projectKey } from '../../src/util/project-key.mjs';
import { gitCommonDir } from './git.mjs';

export async function resolveLedgerRoots(projectDir, env = process.env) {
  const roots = [];
  const dataRoot = env.CLAUDE_PLUGIN_DATA;
  if (typeof dataRoot === 'string' && dataRoot.length > 0) {
    try {
      roots.push(resolve(join(dataRoot, projectKey(projectDir))));
    } catch {
      void 0;
    }
  }
  const common = await gitCommonDir(projectDir);
  if (common) {
    roots.push(join(common, 'ledger'));
  }
  return roots;
}

function realPathOrNull(target) {
  try {
    return realpathSync.native(target);
  } catch {
    return null;
  }
}

export function canonicalPath(target) {
  let current = target;
  for (;;) {
    const real = realPathOrNull(current);
    if (real !== null) {
      return real + target.slice(current.length);
    }
    const parent = dirname(current);
    if (parent === current) {
      return target;
    }
    current = parent;
  }
}

function contains(candidate, root) {
  return candidate === root || candidate.startsWith(root + sep);
}

export function isUnderRoot(candidate, roots, baseDir) {
  if (typeof candidate !== 'string' || candidate.length === 0 || !Array.isArray(roots)) {
    return false;
  }
  const abs = resolve(baseDir ?? process.cwd(), candidate);
  if (roots.some((root) => contains(abs, root))) {
    return true;
  }
  const real = canonicalPath(abs);
  return roots.some((root) => contains(real, canonicalPath(root)));
}
