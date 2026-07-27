import { join } from 'node:path';
import { gitExec } from './git-exec.mjs';
import {
  ABSENT_HOOKS_PATH,
  clearedGitLocationEnv,
  disabledHookArgs,
  isolatedGitArgs,
  isolatedGitConfigEnv,
  nulledGlobalGitConfigEnv,
  volatileGitConfigEnv,
} from './git-env.mjs';

const SAFE_DIRECTORY_KEY = 'safe.directory';
const DISABLED_HOOKS_DIR = 'hooks-disabled';

function assertDir(fn, dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error(`${fn}: dir must be a non-empty string`);
  }
  return dir;
}

function assertGitDir(fn, gitDir) {
  if (typeof gitDir !== 'string' || gitDir.length === 0) {
    throw new Error(`${fn}: gitDir must be a non-empty string`);
  }
  return gitDir;
}

export function safeDirectoryArgs(dir) {
  assertDir('safeDirectoryArgs', dir);
  return ['-c', `${SAFE_DIRECTORY_KEY}=${dir}`];
}

export function hostScope(dir) {
  assertDir('hostScope', dir);
  return {
    dir,
    gitDir: null,
    env: clearedGitLocationEnv(),
    args: disabledHookArgs(ABSENT_HOOKS_PATH),
  };
}

export async function resolveGitDir(dir) {
  assertDir('resolveGitDir', dir);
  let result;
  try {
    result = await gitExec(
      dir,
      [...safeDirectoryArgs(dir), 'rev-parse', '--absolute-git-dir'],
      { env: { ...clearedGitLocationEnv(), ...isolatedGitConfigEnv() }, check: false },
    );
  } catch (error) {
    throw new Error(`resolveGitDir: cannot run git in ${dir}: ${error.message}`, { cause: error });
  }
  const resolved = result.stdout.trim();
  if (result.code !== 0 || resolved === '') {
    throw new Error(
      `resolveGitDir: no git directory for ${dir} (exit ${result.code}): ${result.stderr.trim()}`,
    );
  }
  return resolved;
}

export function pinnedScope(dir, gitDir) {
  assertDir('pinnedScope', dir);
  assertGitDir('pinnedScope', gitDir);
  return { dir, gitDir, env: { ...clearedGitLocationEnv(), GIT_DIR: gitDir }, args: [] };
}

export function networkScope(dir, gitDir) {
  const base = pinnedScope(dir, gitDir);
  return {
    ...base,
    env: { ...base.env, ...volatileGitConfigEnv() },
    args: isolatedGitArgs(join(gitDir, DISABLED_HOOKS_DIR)),
  };
}

export function isolatedScope(dir, gitDir) {
  const base = networkScope(dir, gitDir);
  return {
    ...base,
    env: { ...base.env, ...nulledGlobalGitConfigEnv() },
    args: [...base.args, ...safeDirectoryArgs(dir)],
  };
}

export function scopedExec(scope, args, options = {}) {
  if (!scope || typeof scope !== 'object' || !Array.isArray(scope.args)) {
    return Promise.reject(new Error('scopedExec: scope must carry a dir, env and args'));
  }
  if (!Array.isArray(args)) {
    return Promise.reject(new Error('scopedExec: args must be an array of strings'));
  }
  const { env, ...rest } = options;
  return gitExec(scope.dir, [...scope.args, ...args], {
    ...rest,
    env: env ? { ...scope.env, ...env } : scope.env,
  });
}
