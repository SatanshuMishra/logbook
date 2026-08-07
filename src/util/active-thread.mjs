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

const POINTER_VERBS = Object.freeze({
  write: 'written',
  read: 'read',
  clear: 'cleared',
});

const POINTER_CONSEQUENCES = Object.freeze({
  unreadable: 'the pointer could not be read back, so whether the end-of-session debrief gate is armed cannot be told from here',
  absent: 'the pointer is absent, so the end-of-session debrief gate will not fire until a pointer is written',
  unrecognised: 'the pointer holds a value that is not a thread id, so the end-of-session debrief gate is armed for that value and neither transition_thread nor archive_thread will release it',
});

const UNREADABLE_POINTER = Object.freeze({ known: false, value: null });

function durabilityReason(error) {
  if (error instanceof ActivePointerUnavailable) return error.message;
  const isSyscallFailure = error !== null && typeof error === 'object'
    && typeof error.code === 'string' && typeof error.syscall === 'string';
  return isSyscallFailure ? `the pointer file is unusable (${error.code})` : null;
}

function describeError(error) {
  return error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : String(error);
}

async function observePointer(ctx, tolerated, notice) {
  try {
    return Object.freeze({ known: true, value: await readActiveThread(ctx) });
  } catch (error) {
    if (durabilityReason(error) !== null) return UNREADABLE_POINTER;
    throw new AggregateError(
      [error, tolerated],
      `the pointer could not be read back: ${describeError(error)}; ${notice}`,
    );
  }
}

function pointerConsequence(observed) {
  if (!observed.known) return POINTER_CONSEQUENCES.unreadable;
  if (observed.value === null) return POINTER_CONSEQUENCES.absent;
  if (!isUlid(observed.value)) return POINTER_CONSEQUENCES.unrecognised;
  return `the pointer names ${observed.value}, so the end-of-session debrief gate will fire for that thread`;
}

async function tolerateUnavailable(ctx, verb, run) {
  try {
    return { value: await run(), warning: null };
  } catch (error) {
    const reason = durabilityReason(error);
    if (reason === null) throw error;
    const notice = `active-thread pointer not ${verb}: ${reason}`;
    const consequence = pointerConsequence(await observePointer(ctx, error, notice));
    return { value: null, warning: `${notice}; ${consequence}` };
  }
}

export function writeActiveThreadOrWarn(ctx, threadId) {
  return tolerateUnavailable(ctx, POINTER_VERBS.write, () => writeActiveThread(ctx, threadId));
}

export function readActiveThreadOrWarn(ctx) {
  return tolerateUnavailable(ctx, POINTER_VERBS.read, () => readActiveThread(ctx));
}

export function clearActiveThreadOrWarn(ctx) {
  return tolerateUnavailable(ctx, POINTER_VERBS.clear, () => clearActiveThread(ctx));
}
