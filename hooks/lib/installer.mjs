import { dirname, join, resolve } from 'node:path';
import { mkdir, copyFile, chmod } from 'node:fs/promises';
import { gitExec } from '../../src/util/git-exec.mjs';
import { projectKey } from '../../src/util/project-key.mjs';

export const STANDARD_HOOKS = Object.freeze([
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'post-rewrite',
  'pre-auto-gc',
  'push-to-checkout',
  'post-index-change',
  'sendemail-validate',
  'reference-transaction',
]);

export function managedHooksDir(dataRoot, projectDir) {
  return join(dataRoot, projectKey(projectDir), 'githooks');
}

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
  const { stdout } = await gitExec(repoDir, ['--version']);
  return parseHooksPathSupport(stdout);
}

async function readConfig(repoDir, key) {
  const { code, stdout } = await gitExec(repoDir, ['config', '--get', key], { check: false });
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
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
}

async function applyTrailerConfig(repoDir, disableTrailer) {
  if (disableTrailer === true) {
    await gitExec(repoDir, ['config', 'continuity.trailer', 'false']);
  } else {
    await gitExec(repoDir, ['config', '--unset', 'continuity.trailer'], { check: false });
  }
}

export async function installCommitMsgHook({ repoDir, managedDir, sourceHook, disableTrailer } = {}) {
  if (typeof repoDir !== 'string' || repoDir.length === 0) {
    throw new Error('installCommitMsgHook: repoDir must be a non-empty string');
  }
  if (typeof managedDir !== 'string' || managedDir.length === 0) {
    throw new Error('installCommitMsgHook: managedDir must be a non-empty string');
  }
  if (typeof sourceHook !== 'string' || sourceHook.length === 0) {
    throw new Error('installCommitMsgHook: sourceHook must be a non-empty string');
  }
  if (!(await supportsHooksPath(repoDir))) {
    return { installed: false, alreadyInstalled: false, reason: 'unsupported-git' };
  }

  const dispatcherSource = join(dirname(sourceHook), 'dispatcher');
  const current = await readConfig(repoDir, 'core.hooksPath');
  const alreadyInstalled = current !== null && resolve(current) === resolve(managedDir);

  await copyManagedHooks(managedDir, dispatcherSource, sourceHook);

  if (!alreadyInstalled) {
    await gitExec(repoDir, ['config', 'continuity.priorHooksPath', current ?? '']);
    await gitExec(repoDir, ['config', 'core.hooksPath', managedDir]);
  }

  await applyTrailerConfig(repoDir, disableTrailer);

  const priorHooksPath = alreadyInstalled
    ? await readConfig(repoDir, 'continuity.priorHooksPath')
    : (current ?? '');

  return { installed: true, alreadyInstalled, managedDir, priorHooksPath };
}

export async function uninstallCommitMsgHook({ repoDir, managedDir } = {}) {
  if (typeof repoDir !== 'string' || repoDir.length === 0) {
    throw new Error('uninstallCommitMsgHook: repoDir must be a non-empty string');
  }
  if (typeof managedDir !== 'string' || managedDir.length === 0) {
    throw new Error('uninstallCommitMsgHook: managedDir must be a non-empty string');
  }

  const current = await readConfig(repoDir, 'core.hooksPath');
  if (current === null || resolve(current) !== resolve(managedDir)) {
    return { removed: false };
  }

  const prior = await readConfig(repoDir, 'continuity.priorHooksPath');
  if (prior && prior.length > 0) {
    await gitExec(repoDir, ['config', 'core.hooksPath', prior]);
  } else {
    await gitExec(repoDir, ['config', '--unset', 'core.hooksPath'], { check: false });
  }
  await gitExec(repoDir, ['config', '--unset', 'continuity.priorHooksPath'], { check: false });

  return { removed: true, restoredHooksPath: (prior && prior.length > 0) ? prior : null };
}
