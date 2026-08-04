import { join, resolve } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { gitExec } from './git-exec.mjs';
import { clearedGitLocationEnv } from './git-env.mjs';
import { atomicWrite } from './atomic-write.mjs';
import { projectKey } from './project-key.mjs';
import { isUlid } from './ulid.mjs';

export class ActivePointerUnavailable extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ActivePointerUnavailable';
  }
}

export async function activeThreadPath(ctx) {
  const driver = ctx && ctx.driver;
  if (!driver || typeof driver.isGit !== 'function') {
    throw new Error('activeThreadPath: ctx.driver with isGit() is required');
  }
  const projectDir = ctx.projectDir;
  if (typeof projectDir !== 'string' || projectDir.length === 0) {
    throw new Error('activeThreadPath: ctx.projectDir must be a non-empty string');
  }
  if (driver.isGit()) {
    const { stdout } = await gitExec(projectDir, ['rev-parse', '--git-common-dir'], {
      env: clearedGitLocationEnv(),
    });
    const commonDir = resolve(projectDir, stdout.trim());
    return join(commonDir, 'ledger', 'active-thread');
  }
  const dataRoot = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataRoot) {
    throw new ActivePointerUnavailable(
      'CLAUDE_PLUGIN_DATA is not set, so a non-git project has nowhere to keep the pointer',
    );
  }
  return join(dataRoot, projectKey(projectDir), 'active-thread');
}

export async function writeActiveThread(ctx, threadId) {
  if (!isUlid(threadId)) {
    throw new Error(`writeActiveThread: threadId must be a ULID, received ${threadId}`);
  }
  const target = await activeThreadPath(ctx);
  await atomicWrite(target, `${threadId}\n`);
  return target;
}

export async function readActiveThread(ctx) {
  const target = await activeThreadPath(ctx);
  try {
    const raw = await readFile(target, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function clearActiveThread(ctx) {
  const target = await activeThreadPath(ctx);
  await rm(target, { force: true });
  return target;
}

async function tolerateUnavailable(action, run) {
  try {
    return { value: await run(), warning: null };
  } catch (error) {
    if (error instanceof ActivePointerUnavailable) {
      return { value: null, warning: `active-thread pointer not ${action}: ${error.message}` };
    }
    throw error;
  }
}

export function writeActiveThreadOrWarn(ctx, threadId) {
  return tolerateUnavailable('written', () => writeActiveThread(ctx, threadId));
}

export function readActiveThreadOrWarn(ctx) {
  return tolerateUnavailable('read', () => readActiveThread(ctx));
}

export function clearActiveThreadOrWarn(ctx) {
  return tolerateUnavailable('cleared', () => clearActiveThread(ctx));
}
