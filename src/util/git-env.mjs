import { devNull } from 'node:os';

export const GIT_LOCATION_VARS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
]);

export const GIT_CONFIG_SOURCE_VARS = Object.freeze([
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_TEMPLATE_DIR',
]);

const HOOKS_PATH_KEY = 'core.hooksPath';
const FSMONITOR_DISABLED = 'core.fsmonitor=false';

function unsetAll(names) {
  const env = {};
  for (const name of names) {
    env[name] = undefined;
  }
  return env;
}

export function clearedGitLocationEnv() {
  return unsetAll(GIT_LOCATION_VARS);
}

export function volatileGitConfigEnv() {
  return {
    ...unsetAll(GIT_CONFIG_SOURCE_VARS),
    GIT_CONFIG_COUNT: '0',
  };
}

export function nulledGlobalGitConfigEnv() {
  return {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
  };
}

export function isolatedGitConfigEnv() {
  return { ...volatileGitConfigEnv(), ...nulledGlobalGitConfigEnv() };
}

export function isolatedGitArgs(hooksPath) {
  if (typeof hooksPath !== 'string' || hooksPath.length === 0) {
    throw new Error('isolatedGitArgs: hooksPath must be a non-empty string');
  }
  return ['-c', `${HOOKS_PATH_KEY}=${hooksPath}`, '-c', FSMONITOR_DISABLED];
}
