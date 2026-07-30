import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { isProjectKey, projectKey } from '../../src/util/project-key.mjs';
import { contains, physicalPath, realDir, workTreeTop } from './git-config-scope.mjs';

export const MANAGED_HOOKS_DIRNAME = 'githooks';

export const MANAGED_SENTINEL_FILE = '.continuity-managed-hooks';

export function managedHooksDir(dataRoot, projectDir) {
  return join(dataRoot, projectKey(projectDir), MANAGED_HOOKS_DIRNAME);
}

export function pluginDataRoot(managedDir) {
  return resolve(managedDir, '..', '..');
}

async function readManagedSentinel(dir) {
  try {
    const raw = await readFile(join(dir, MANAGED_SENTINEL_FILE), 'utf8');
    return raw.split('\n')[0].trim();
  } catch {
    return null;
  }
}

export async function writeManagedSentinel(managedDir) {
  const declared = (await realDir(managedDir)) ?? resolve(managedDir);
  await writeFile(join(managedDir, MANAGED_SENTINEL_FILE), `${declared}\n`, { mode: 0o644 });
}

export async function isManagedHooksDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return false;
  }
  const declared = await readManagedSentinel(dir);
  if (declared === null || declared.length === 0) {
    return false;
  }
  const [declaredReal, dirReal] = await Promise.all([realDir(declared), realDir(dir)]);
  return declaredReal !== null && dirReal !== null && declaredReal === dirReal;
}

async function dataRootExcludesWorkTree(repoDir, dataRoot) {
  const top = await workTreeTop(repoDir);
  if (top === null) {
    return true;
  }
  const [rootPhysical, topPhysical] = await Promise.all([physicalPath(dataRoot), physicalPath(top)]);
  return !contains(rootPhysical, topPhysical);
}

async function isPluginOwnedHooksDir(candidateDir, managedDir, repoDir) {
  const dataRoot = pluginDataRoot(managedDir);
  if (!(await dataRootExcludesWorkTree(repoDir, dataRoot))) {
    return false;
  }
  const [rootPhysical, candidatePhysical] = await Promise.all([
    physicalPath(dataRoot),
    physicalPath(candidateDir),
  ]);
  const rel = relative(rootPhysical, candidatePhysical);
  if (rel.length === 0 || isAbsolute(rel)) {
    return false;
  }
  const parts = rel.split(sep);
  return parts.length === 2 && isProjectKey(parts[0]) && parts[1] === MANAGED_HOOKS_DIRNAME;
}

export async function isManagedHooksDirIdentity(candidateDir, managedDir, repoDir) {
  if (typeof candidateDir !== 'string' || candidateDir.length === 0) {
    return false;
  }
  if (typeof managedDir !== 'string' || managedDir.length === 0) {
    return false;
  }
  const [candidateReal, managedReal] = await Promise.all([
    realDir(candidateDir),
    realDir(managedDir),
  ]);
  if (candidateReal !== null && candidateReal === managedReal) {
    return true;
  }
  if (await isPluginOwnedHooksDir(candidateDir, managedDir, repoDir)) {
    return true;
  }
  return isManagedHooksDir(candidateDir);
}
