import { isAbsolute } from 'node:path';

export function projectKey(absoluteDir) {
  if (typeof absoluteDir !== 'string') {
    throw new TypeError('projectKey: expected a string path');
  }
  if (!isAbsolute(absoluteDir)) {
    throw new Error(`projectKey: expected an absolute path, received ${absoluteDir}`);
  }
  return absoluteDir.replace(/[^a-zA-Z0-9]/g, '-');
}
