import { isAbsolute } from 'node:path';

const PROJECT_KEY_CHARSET = /^[a-zA-Z0-9-]+$/;

export function isProjectKey(value) {
  return typeof value === 'string' && PROJECT_KEY_CHARSET.test(value) && value.includes('-');
}

export function projectKey(absoluteDir) {
  if (typeof absoluteDir !== 'string') {
    throw new TypeError('projectKey: expected a string path');
  }
  if (!isAbsolute(absoluteDir)) {
    throw new Error(`projectKey: expected an absolute path, received ${absoluteDir}`);
  }
  return absoluteDir.replace(/[^a-zA-Z0-9]/g, '-');
}
