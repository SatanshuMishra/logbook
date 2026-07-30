import { dirname, join, resolve } from 'node:path';
import { mkdir, copyFile, chmod } from 'node:fs/promises';
import { STANDARD_HOOKS } from './hook-names.mjs';
import { readConfig, repoExec } from './git-config-scope.mjs';
import { writeManagedSentinel } from './managed-hooks-identity.mjs';
import {
  PRIOR_HOOKS_PATH_CAPTURE,
  PRIOR_HOOKS_PATH_KEY,
  PRIOR_HOOKS_PATH_KEYS,
  capturePriorHooksPath,
  healPriorHooksPath,
  readInheritedHooksPath,
} from './prior-hooks-path.mjs';

export { STANDARD_HOOKS, CHAINABLE_HOOKS } from './hook-names.mjs';
export {
  MANAGED_HOOKS_DIRNAME,
  MANAGED_SENTINEL_FILE,
  isManagedHooksDir,
  isManagedHooksDirIdentity,
  managedHooksDir,
  pluginDataRoot,
} from './managed-hooks-identity.mjs';
export {
  CAPTURED_PRIOR_HOOKS_PATH_KEY,
  CORRUPT_PRIOR_HOOKS_PATH_KEY,
  DECLINED_PRIOR_HOOKS_PATH_KEY,
  PRIOR_HOOKS_PATH_CAPTURE,
  PRIOR_HOOKS_PATH_HEAL,
  PRIOR_HOOKS_PATH_KEY,
} from './prior-hooks-path.mjs';

export function parseHooksPathSupport(versionOutput) {
  const match = /(\d+)\.(\d+)/.exec(String(versionOutput ?? ''));
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 9);
}

export async function supportsHooksPath(repoDir) {
  const { stdout } = await repoExec(repoDir, ['--version']);
  return parseHooksPathSupport(stdout);
}

function samePath(a, b) {
  return typeof a === 'string' && typeof b === 'string' && resolve(a) === resolve(b);
}

function setLocalConfig(repoDir, key, value) {
  return repoExec(repoDir, ['config', '--local', '--replace-all', key, value]);
}

async function copyManagedHooks(managedDir, dispatcherSource, sourceHook) {
  await mkdir(managedDir, { recursive: true });
  for (const name of STANDARD_HOOKS) {
    const dest = join(managedDir, name);
    await copyFile(dispatcherSource, dest);
    await chmod(dest, 0o755);
  }
  const commitMsgDest = join(managedDir, 'commit-msg');
  await copyFile(sourceHook, commitMsgDest);
  await chmod(commitMsgDest, 0o755);
  await writeManagedSentinel(managedDir);
}

async function applyTrailerConfig(repoDir, disableTrailer) {
  if (disableTrailer === true) {
    await setLocalConfig(repoDir, 'continuity.trailer', 'false');
    return;
  }
  await repoExec(repoDir, ['config', '--local', '--unset-all', 'continuity.trailer'], { check: false });
}

function requireString(name, field, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name}: ${field} must be a non-empty string`);
  }
}

export async function installCommitMsgHook({ repoDir, managedDir, sourceHook, disableTrailer } = {}) {
  requireString('installCommitMsgHook', 'repoDir', repoDir);
  requireString('installCommitMsgHook', 'managedDir', managedDir);
  requireString('installCommitMsgHook', 'sourceHook', sourceHook);
  if (!(await supportsHooksPath(repoDir))) {
    return { installed: false, alreadyInstalled: false, reason: 'unsupported-git' };
  }

  const dispatcherSource = join(dirname(sourceHook), 'dispatcher');
  const current = await readConfig(repoDir, 'core.hooksPath');
  const currentDir = current === null || current === '' ? null : resolve(repoDir, current);
  const alreadyInstalled = currentDir !== null && currentDir === resolve(managedDir);

  await copyManagedHooks(managedDir, dispatcherSource, sourceHook);

  const capture = alreadyInstalled
    ? { priorHooksPathCapture: PRIOR_HOOKS_PATH_CAPTURE.retained, declinedHooksPath: null }
    : await capturePriorHooksPath(repoDir, managedDir, current, currentDir);
  if (!alreadyInstalled) {
    await setLocalConfig(repoDir, 'core.hooksPath', managedDir);
  }

  await applyTrailerConfig(repoDir, disableTrailer);

  const heal = await healPriorHooksPath(repoDir, managedDir);

  return { installed: true, alreadyInstalled, managedDir, ...capture, ...heal };
}

export async function uninstallCommitMsgHook({ repoDir, managedDir } = {}) {
  requireString('uninstallCommitMsgHook', 'repoDir', repoDir);
  requireString('uninstallCommitMsgHook', 'managedDir', managedDir);

  const current = await readConfig(repoDir, 'core.hooksPath');
  if (current === null || resolve(current) !== resolve(managedDir)) {
    return { removed: false };
  }

  const prior = await readConfig(repoDir, PRIOR_HOOKS_PATH_KEY);
  const inherited = await readInheritedHooksPath(repoDir);
  const restored = (prior && prior.length > 0 && !samePath(prior, inherited)) ? prior : null;

  if (restored !== null) {
    await setLocalConfig(repoDir, 'core.hooksPath', restored);
  } else {
    await repoExec(repoDir, ['config', '--local', '--unset-all', 'core.hooksPath'], { check: false });
  }
  for (const key of PRIOR_HOOKS_PATH_KEYS) {
    await repoExec(repoDir, ['config', '--local', '--unset-all', key], { check: false });
  }

  return { removed: true, restoredHooksPath: restored };
}
