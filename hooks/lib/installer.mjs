import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { mkdir, copyFile, chmod, readFile, realpath, writeFile } from 'node:fs/promises';
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

export const MANAGED_SENTINEL_FILE = '.continuity-managed-hooks';

async function readManagedSentinel(dir) {
  try {
    const raw = await readFile(join(dir, MANAGED_SENTINEL_FILE), 'utf8');
    return raw.split('\n')[0].trim();
  } catch {
    return null;
  }
}

export async function isManagedHooksDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    return false;
  }
  const declared = await readManagedSentinel(dir);
  if (declared === null || declared.length === 0) {
    return false;
  }
  const [declaredReal, dirReal] = await Promise.all([realHooksDir(declared), realHooksDir(dir)]);
  return declaredReal !== null && dirReal !== null && declaredReal === dirReal;
}

export async function hasManagedDispatcherContent(dir) {
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

export const PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPath';
export const CAPTURED_PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPathCaptured';
export const CORRUPT_PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPathCorrupt';

export const PRIOR_HOOKS_PATH_HEAL = Object.freeze({
  notNeeded: 'not-needed',
  healed: 'healed',
  unrecoverable: 'unrecoverable',
  failed: 'failed',
});

function trimTrailingNewline(value) {
  return String(value ?? '').replace(/\r?\n$/, '');
}

async function readConfig(repoDir, key) {
  const { code, stdout } = await repoExec(repoDir, ['config', '--local', '--get', key], { check: false });
  return code === 0 ? trimTrailingNewline(stdout) : null;
}

async function priorHooksPathOriginScope(repoDir, origin) {
  if (typeof origin !== 'string' || origin.length === 0) {
    return null;
  }
  const originFile = resolve(repoDir, origin.replace(/^file:/, ''));
  const { code, stdout } = await repoExec(repoDir, ['rev-parse', '--absolute-git-dir'], { check: false });
  if (code !== 0) {
    return 'inherited';
  }
  const gitDir = trimTrailingNewline(stdout);
  if (originFile === join(gitDir, 'config.worktree')) {
    return 'worktree';
  }
  if (originFile === join(gitDir, 'config')) {
    return 'local';
  }
  return 'inherited';
}

async function readEffectivePriorHooksPath(repoDir) {
  const all = await persistentScopeExec(repoDir, ['config', '--get-all', PRIOR_HOOKS_PATH_KEY]);
  if (all.code !== 0) {
    return { value: null, count: 0, scope: null };
  }
  const values = trimTrailingNewline(all.stdout).split('\n');
  const shown = await persistentScopeExec(
    repoDir,
    ['config', '--show-origin', '--get', PRIOR_HOOKS_PATH_KEY],
  );
  const origin = shown.code === 0 ? trimTrailingNewline(shown.stdout).split('\t')[0] : null;
  return {
    value: values[values.length - 1],
    count: values.length,
    scope: await priorHooksPathOriginScope(repoDir, origin),
  };
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

async function isManagedHooksDirIdentity(candidateDir, managedDir) {
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

async function looksLikeManagedHooksDir(candidateDir, managedDir) {
  if (await isManagedHooksDirIdentity(candidateDir, managedDir)) {
    return true;
  }
  return hasManagedDispatcherContent(candidateDir);
}

async function physicalPath(candidate) {
  const direct = await realHooksDir(candidate);
  if (direct !== null) {
    return direct;
  }
  const parent = await realHooksDir(dirname(candidate));
  return parent === null ? resolve(candidate) : join(parent, basename(candidate));
}

async function isInsideWorkTree(repoDir, candidate) {
  const { code, stdout } = await repoExec(repoDir, ['rev-parse', '--show-toplevel'], { check: false });
  const top = trimTrailingNewline(stdout);
  if (code !== 0 || top.length === 0) {
    return false;
  }
  const rel = relative(await physicalPath(top), await physicalPath(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function priorHooksPathIsCorrupt(repoDir, managedDir, effective) {
  if (effective.count > 1) {
    return true;
  }
  if (effective.value === null || effective.value.length === 0) {
    return false;
  }
  return isManagedHooksDirIdentity(resolve(repoDir, effective.value), managedDir);
}

async function recoverPriorHooksPath(repoDir, managedDir) {
  const captured = await readConfig(repoDir, CAPTURED_PRIOR_HOOKS_PATH_KEY);
  if (captured !== null && captured.length === 0) {
    return { value: '', recovered: true };
  }
  if (captured !== null && !(await isManagedHooksDirIdentity(resolve(repoDir, captured), managedDir))) {
    return { value: resolve(repoDir, captured), recovered: true };
  }
  const inherited = await readInheritedHooksPath(repoDir);
  if (inherited === null) {
    return { value: '', recovered: false };
  }
  const absolute = resolve(repoDir, inherited);
  const unusable = await isManagedHooksDirIdentity(absolute, managedDir)
    || await isInsideWorkTree(repoDir, absolute);
  return unusable ? { value: '', recovered: false } : { value: absolute, recovered: true };
}

async function worktreeConfigEnabled(repoDir) {
  const { code, stdout } = await repoExec(
    repoDir,
    ['config', '--local', '--get', 'extensions.worktreeConfig'],
    { check: false },
  );
  return code === 0 && trimTrailingNewline(stdout) === 'true';
}

async function clearWorktreeScopePriorHooksPath(repoDir) {
  if (!(await worktreeConfigEnabled(repoDir))) {
    return;
  }
  const { code } = await repoExec(
    repoDir,
    ['config', '--worktree', '--get', PRIOR_HOOKS_PATH_KEY],
    { check: false },
  );
  if (code !== 0) {
    return;
  }
  await repoExec(
    repoDir,
    ['config', '--worktree', '--unset-all', PRIOR_HOOKS_PATH_KEY],
    { check: false },
  );
}

function healOutcome(corruptValue, scope, priorHooksPath, priorHooksPathHeal) {
  return {
    priorHooksPath,
    priorHooksPathHeal,
    corruptPriorHooksPath: corruptValue,
    corruptPriorHooksPathScope: scope,
  };
}

async function writeHealedPriorHooksPath(repoDir, effective, recovered) {
  const corruptValue = effective.value ?? '';
  const scope = effective.scope;
  await repoExec(
    repoDir,
    ['config', '--local', '--replace-all', CORRUPT_PRIOR_HOOKS_PATH_KEY, corruptValue],
    { check: false },
  );
  const { code } = await repoExec(
    repoDir,
    ['config', '--local', '--replace-all', PRIOR_HOOKS_PATH_KEY, recovered.value],
    { check: false },
  );
  if (code !== 0) {
    return healOutcome(corruptValue, scope, corruptValue, PRIOR_HOOKS_PATH_HEAL.failed);
  }
  await clearWorktreeScopePriorHooksPath(repoDir);
  if (!recovered.recovered) {
    return healOutcome(corruptValue, scope, '', PRIOR_HOOKS_PATH_HEAL.unrecoverable);
  }
  await repoExec(
    repoDir,
    ['config', '--local', '--unset-all', CORRUPT_PRIOR_HOOKS_PATH_KEY],
    { check: false },
  );
  return healOutcome(corruptValue, scope, recovered.value, PRIOR_HOOKS_PATH_HEAL.healed);
}

async function healPriorHooksPath(repoDir, managedDir) {
  const effective = await readEffectivePriorHooksPath(repoDir);
  if (!(await priorHooksPathIsCorrupt(repoDir, managedDir, effective))) {
    return healOutcome(null, null, effective.value ?? '', PRIOR_HOOKS_PATH_HEAL.notNeeded);
  }
  const recovered = await recoverPriorHooksPath(repoDir, managedDir);
  return writeHealedPriorHooksPath(repoDir, effective, recovered);
}

async function writeManagedSentinel(managedDir) {
  const declared = (await realHooksDir(managedDir)) ?? resolve(managedDir);
  await writeFile(join(managedDir, MANAGED_SENTINEL_FILE), `${declared}\n`, { mode: 0o644 });
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

async function capturePriorHooksPath(repoDir, current) {
  await repoExec(repoDir, ['config', '--local', '--replace-all', PRIOR_HOOKS_PATH_KEY, current]);
  const captured = current.length === 0 ? '' : resolve(repoDir, current);
  await repoExec(
    repoDir,
    ['config', '--local', '--replace-all', CAPTURED_PRIOR_HOOKS_PATH_KEY, captured],
    { check: false },
  );
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
    if (!(await looksLikeManagedHooksDir(currentDir, managedDir))) {
      await capturePriorHooksPath(repoDir, current ?? '');
    }
    await repoExec(repoDir, ['config', '--local', 'core.hooksPath', managedDir]);
  }

  await applyTrailerConfig(repoDir, disableTrailer);

  const heal = await healPriorHooksPath(repoDir, managedDir);

  return { installed: true, alreadyInstalled, managedDir, ...heal };
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

  const prior = await readConfig(repoDir, PRIOR_HOOKS_PATH_KEY);
  const inherited = await readInheritedHooksPath(repoDir);
  const restored = (prior && prior.length > 0 && !samePath(prior, inherited)) ? prior : null;

  if (restored !== null) {
    await repoExec(repoDir, ['config', '--local', 'core.hooksPath', restored]);
  } else {
    await repoExec(repoDir, ['config', '--local', '--unset', 'core.hooksPath'], { check: false });
  }
  for (const key of [PRIOR_HOOKS_PATH_KEY, CAPTURED_PRIOR_HOOKS_PATH_KEY, CORRUPT_PRIOR_HOOKS_PATH_KEY]) {
    await repoExec(repoDir, ['config', '--local', '--unset-all', key], { check: false });
  }

  return { removed: true, restoredHooksPath: restored };
}
