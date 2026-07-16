import { join, resolve, sep } from 'node:path';
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

export function isUnderRoot(candidate, roots, baseDir) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }
  const abs = resolve(baseDir ?? process.cwd(), candidate);
  return roots.some((root) => abs === root || abs.startsWith(root + sep));
}
