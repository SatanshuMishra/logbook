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

async function gitLedgerDir(projectDir) {
  try {
    const { stdout } = await gitExec(projectDir, ['rev-parse', '--git-common-dir'], {
      env: clearedGitLocationEnv(),
    });
    return join(resolve(projectDir, stdout.trim()), 'ledger');
  } catch {
    throw new ActivePointerUnavailable('the project git directory could not be resolved');
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
    return join(await gitLedgerDir(projectDir), 'active-thread');
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

const POINTER_OUTCOMES = Object.freeze({
  write: Object.freeze({
    verb: 'written',
    consequence: 'the pointer is absent, so the end-of-session debrief gate will not fire for this thread until the pointer is restored',
  }),
  read: Object.freeze({
    verb: 'read',
    consequence: 'the pointer state is unknown, so whether the end-of-session debrief gate still owes this thread a debrief cannot be told from here',
  }),
  clear: Object.freeze({
    verb: 'cleared',
    consequence: 'the pointer survives, so the end-of-session debrief gate will keep firing for this thread until the pointer is removed',
  }),
});

function durabilityReason(error) {
  if (error instanceof ActivePointerUnavailable) return error.message;
  const isSyscallFailure = error !== null && typeof error === 'object'
    && typeof error.code === 'string' && typeof error.syscall === 'string';
  return isSyscallFailure ? `the pointer file is unusable (${error.code})` : null;
}

async function tolerateUnavailable(action, run) {
  const outcome = POINTER_OUTCOMES[action];
  if (outcome === undefined) {
    throw new Error(`tolerateUnavailable: action must be one of ${Object.keys(POINTER_OUTCOMES).join(', ')}, received ${action}`);
  }
  try {
    return { value: await run(), warning: null };
  } catch (error) {
    const reason = durabilityReason(error);
    if (reason === null) throw error;
    return {
      value: null,
      warning: `active-thread pointer not ${outcome.verb}: ${reason}; ${outcome.consequence}`,
    };
  }
}

export function writeActiveThreadOrWarn(ctx, threadId) {
  return tolerateUnavailable('write', () => writeActiveThread(ctx, threadId));
}

export function readActiveThreadOrWarn(ctx) {
  return tolerateUnavailable('read', () => readActiveThread(ctx));
}

export function clearActiveThreadOrWarn(ctx) {
  return tolerateUnavailable('clear', () => clearActiveThread(ctx));
}
