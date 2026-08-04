import { join, resolve } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { gitExec, isGitUsageError } from './git-exec.mjs';
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

function isSyscallFailure(error) {
  return error !== null && typeof error === 'object'
    && typeof error.code === 'string' && typeof error.syscall === 'string';
}

function gitFailureLabel(error) {
  const code = error === null || typeof error !== 'object' ? undefined : error.code;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return `exit ${code}`;
  const signal = error !== null && typeof error === 'object' ? error.signal : undefined;
  return typeof signal === 'string' ? signal : 'no diagnosis';
}

async function gitLedgerDir(projectDir) {
  let stdout;
  try {
    ({ stdout } = await gitExec(projectDir, ['rev-parse', '--git-common-dir'], {
      env: clearedGitLocationEnv(),
    }));
  } catch (error) {
    if (isGitUsageError(error)) throw error;
    throw new ActivePointerUnavailable(
      `the project git directory could not be resolved (${gitFailureLabel(error)})`,
    );
  }
  return join(resolve(projectDir, stdout.trim()), 'ledger');
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

const WRITE_CONSEQUENCE =
  'the end-of-session debrief gate will not fire for this thread until the pointer is written';

const CLEAR_CONSEQUENCE =
  'the pointer still names this thread, so every session end will keep demanding a debrief for it until the pointer is removed';

function durabilityReason(error) {
  if (error instanceof ActivePointerUnavailable) return error.message;
  return isSyscallFailure(error) ? `the pointer file is unusable (${error.code})` : null;
}

async function tolerateUnavailable(action, consequence, run) {
  try {
    return { value: await run(), warning: null };
  } catch (error) {
    const reason = durabilityReason(error);
    if (reason === null) throw error;
    return {
      value: null,
      warning: `active-thread pointer not ${action}: ${reason}; ${consequence}`,
    };
  }
}

export function writeActiveThreadOrWarn(ctx, threadId) {
  return tolerateUnavailable('written', WRITE_CONSEQUENCE, () => writeActiveThread(ctx, threadId));
}

export function clearActiveThreadOrWarn(ctx) {
  return tolerateUnavailable('cleared', CLEAR_CONSEQUENCE, () => clearActiveThread(ctx));
}

const ABSENT_CONSEQUENCE =
  'no pointer can name this thread, so the end-of-session debrief gate will not fire for it';

export async function readActiveThreadOrAbsent(ctx) {
  try {
    return { value: await readActiveThread(ctx), warning: null };
  } catch (error) {
    if (!(error instanceof ActivePointerUnavailable)) throw error;
    return {
      value: null,
      warning: `active-thread pointer store unreachable: ${error.message}; ${ABSENT_CONSEQUENCE}`,
    };
  }
}
