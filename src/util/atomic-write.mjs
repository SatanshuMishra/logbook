import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { newUlid } from './ulid.mjs';

export async function atomicWrite(targetPath, contents) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('atomicWrite: targetPath must be a non-empty string');
  }
  if (typeof contents !== 'string') {
    throw new TypeError('atomicWrite: contents must be a string');
  }
  const tmpPath = `${targetPath}.tmp-${newUlid()}`;
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await writeFile(tmpPath, contents, 'utf8');
    await rename(tmpPath, targetPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
  return targetPath;
}
