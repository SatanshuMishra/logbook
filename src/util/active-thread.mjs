import { readFile, rm } from 'node:fs/promises';
import { atomicWrite } from './atomic-write.mjs';
import { isUlid } from './ulid.mjs';

export class ActivePointerUnavailable extends Error {
  constructor(reason, options) {
    super(reason, options);
    this.name = 'ActivePointerUnavailable';
  }
}

export async function activeThreadPath(ctx) {
  const driver = ctx && ctx.driver;
  if (!driver || typeof driver.activeThreadPointerPath !== 'function') {
    throw new Error('activeThreadPath: ctx.driver with activeThreadPointerPath() is required');
  }
  return driver.activeThreadPointerPath();
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

export const POINTER_VERBS = Object.freeze({
  write: 'written',
  read: 'read',
  clear: 'cleared',
  recognise: 'recognised',
});

export const POINTER_CONSEQUENCES = Object.freeze({
  unreadable: 'the pointer could not be read back, so whether the end-of-session debrief gate is armed cannot be told from here',
  absent: 'the pointer is absent, so the end-of-session debrief gate will not fire until a pointer is written',
  unrecognised: 'the pointer holds a value that is not a thread id, so the end-of-session debrief gate will not fire and no tool will release it',
});

export function pointerNotice(verb, reason) {
  return `active-thread pointer not ${verb}: ${reason}`;
}

const UNREADABLE_POINTER = Object.freeze({ known: false, value: null });

export function pointerSyscallErrno(error) {
  const isSyscallFailure = error !== null && typeof error === 'object'
    && typeof error.code === 'string' && typeof error.syscall === 'string';
  return isSyscallFailure ? error.code : null;
}

function durabilityReason(error) {
  if (error instanceof ActivePointerUnavailable) return error.message;
  const errno = pointerSyscallErrno(error);
  return errno === null ? null : `the filesystem call failed (${errno})`;
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
    const notice = pointerNotice(verb, reason);
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

async function releaseIfStillNamed(ctx, expectedId) {
  const held = await readActiveThread(ctx);
  if (held !== expectedId) return Object.freeze({ released: false, held });
  await clearActiveThread(ctx);
  return Object.freeze({ released: true, held: null });
}

function pointerMoved(held) {
  const consequence = pointerConsequence(Object.freeze({ known: true, value: held }));
  return `active-thread pointer not cleared: it no longer names this thread; ${consequence}`;
}

export async function releaseActiveThreadOrWarn(ctx, expectedId) {
  if (!isUlid(expectedId)) {
    throw new Error(`releaseActiveThreadOrWarn: expectedId must be a ULID, received ${expectedId}`);
  }
  const outcome = await tolerateUnavailable(
    ctx,
    POINTER_VERBS.clear,
    () => releaseIfStillNamed(ctx, expectedId),
  );
  if (outcome.warning !== null) return outcome;
  if (outcome.value.released || outcome.value.held === null) return { value: outcome.value, warning: null };
  return { value: outcome.value, warning: pointerMoved(outcome.value.held) };
}
