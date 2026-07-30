import { dirname, join, resolve } from 'node:path';
import { mkdir, copyFile, chmod, readFile, realpath } from 'node:fs/promises';
import { gitExec } from '../../src/util/git-exec.mjs';
import { clearedGitLocationEnv, isolatedGitConfigEnv } from '../../src/util/git-env.mjs';
import { projectKey } from '../../src/util/project-key.mjs';

function repoExec(repoDir, args, options = {}) {
  return gitExec(repoDir, args, {
    ...options,
    env: { ...clearedGitLocationEnv(), ...isolatedGitConfigEnv() },
  });
}

function persistentScopeExec(repoDir, args) {
  return gitExec(repoDir, args, { check: false, env: clearedGitLocationEnv() });
}

const INHERITED_HOOKS_PATH_SCOPES = Object.freeze(['--global', '--system']);

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
  const { stdout } = await repoExec(repoDir, ['--version']);
  return parseHooksPathSupport(stdout);
}

const MANAGED_DISPATCHER_MARKER = 'continuity.priorHooksPath';

export async function isManagedHooksDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return false;
  }
  try {
    const probe = await readFile(join(dir, 'pre-commit'), 'utf8');
    return probe.includes(MANAGED_DISPATCHER_MARKER);
  } catch {
    return false;
  }
}

async function readConfig(repoDir, key) {
  const { code, stdout } = await repoExec(repoDir, ['config', '--local', '--get', key], { check: false });
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
}

async function readInheritedHooksPath(repoDir) {
  for (const scope of INHERITED_HOOKS_PATH_SCOPES) {
    const { code, stdout } = await persistentScopeExec(
      repoDir,
      ['config', scope, '--get', 'core.hooksPath'],
    );
    if (code !== 0) {
      continue;
    }
    const value = stdout.replace(/\r?\n$/, '');
    if (value.length > 0) {
      return value;
    }
  }
  return null;
}

function samePath(a, b) {
  return typeof a === 'string' && typeof b === 'string' && resolve(a) === resolve(b);
}

async function realHooksDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return null;
  }
  try {
    return await realpath(dir);
  } catch {
    return null;
  }
}

async function resolvesToManagedHooksDir(candidateDir, managedDir) {
  if (typeof candidateDir !== 'string' || candidateDir.length === 0) {
    return false;
  }
  const [candidateReal, managedReal] = await Promise.all([
    realHooksDir(candidateDir),
    realHooksDir(managedDir),
  ]);
  if (candidateReal !== null && candidateReal === managedReal) {
    return true;
  }
  return isManagedHooksDir(candidateDir);
}

async function healPriorHooksPath(repoDir, managedDir) {
  const stored = await readConfig(repoDir, 'continuity.priorHooksPath');
  if (stored === null || stored.length === 0) {
    return '';
  }
  if (!(await resolvesToManagedHooksDir(resolve(repoDir, stored), managedDir))) {
    return stored;
  }
  const inherited = await readInheritedHooksPath(repoDir);
  const inheritedIsManaged = inherited !== null
    && await resolvesToManagedHooksDir(resolve(repoDir, inherited), managedDir);
  const healed = (inherited !== null && !inheritedIsManaged) ? inherited : '';
  const { code } = await repoExec(
    repoDir,
    ['config', '--local', 'continuity.priorHooksPath', healed],
    { check: false },
  );
  return code === 0 ? healed : stored;
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
    await repoExec(repoDir, ['config', '--local', 'continuity.trailer', 'false']);
  } else {
    await repoExec(repoDir, ['config', '--local', '--unset', 'continuity.trailer'], { check: false });
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
  const currentDir = current === null || current === '' ? null : resolve(repoDir, current);
  const alreadyInstalled = currentDir !== null && currentDir === resolve(managedDir);

  await copyManagedHooks(managedDir, dispatcherSource, sourceHook);

  if (!alreadyInstalled) {
    if (!(await resolvesToManagedHooksDir(currentDir, managedDir))) {
      await repoExec(repoDir, ['config', '--local', 'continuity.priorHooksPath', current ?? '']);
    }
    await repoExec(repoDir, ['config', '--local', 'core.hooksPath', managedDir]);
  }

  await applyTrailerConfig(repoDir, disableTrailer);

  const priorHooksPath = await healPriorHooksPath(repoDir, managedDir);

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
  const inherited = await readInheritedHooksPath(repoDir);
  const restored = (prior && prior.length > 0 && !samePath(prior, inherited)) ? prior : null;

  if (restored !== null) {
    await repoExec(repoDir, ['config', '--local', 'core.hooksPath', restored]);
  } else {
    await repoExec(repoDir, ['config', '--local', '--unset', 'core.hooksPath'], { check: false });
  }
  await repoExec(repoDir, ['config', '--local', '--unset', 'continuity.priorHooksPath'], { check: false });

  return { removed: true, restoredHooksPath: restored };
}
