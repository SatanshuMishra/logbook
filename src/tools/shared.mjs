import { access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { echoBetween, escapeFormat } from '../errors.mjs';
import { rebuildIndex } from '../index/rebuild-index.mjs';
import { ALLOWED_TRANSITIONS, THREAD_STATUSES, canTransition } from '../model/fsm.mjs';
import { liveCriteria } from '../model/selection.mjs';
import {
  ActivePointerUnavailable,
  POINTER_CONSEQUENCES,
  POINTER_VERBS,
  activeThreadPath,
  pointerNotice,
  pointerSyscallErrno,
  readActiveThread,
  readActiveThreadOrWarn,
} from '../util/active-thread.mjs';
import { isUlid } from '../util/ulid.mjs';

export {
  LedgerError,
  ToolError,
  LEDGER_ERROR_LAYERS,
  LEDGER_ERROR_CODES,
  MESSAGE_MAX_CHARS,
  DETAIL_MAX_BYTES,
  renderLedgerError,
  isLedgerError,
  toLedgerError,
} from '../errors.mjs';

export function unknownThread(tool, field, id) {
  return {
    code: 'unknown_thread',
    field: `${tool}.${field}`,
    expected: 'a thread id this ledger holds',
    example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    retryable: false,
    remedy: echoBetween(
      'no thread is stored under ',
      '; thread ids are server-assigned, so re-send with an id this ledger returned',
      id,
    ),
  };
}

export function terminalThread(tool, status) {
  return {
    code: 'terminal_thread',
    field: `${tool}.thread_id`,
    expected: 'a thread whose status is active, paused or blocked',
    retryable: false,
    remedy: `this thread is ${status}; terminal threads never mutate again, so open a successor with create_successor instead`,
  };
}

export const NO_POINTER = Object.freeze({ value: null, warning: null });

const RELEASE_SKIPPED = 'no pointer was released';

const OCCUPIED_POINTERS = Object.freeze({
  EISDIR: Object.freeze({
    observed: 'a directory sits at the pointer path (EISDIR), so nothing can be read or released from it',
    remedy: 'the directory at the pointer path has to be removed or replaced on disk, and no tool here can do that',
  }),
  ENOTDIR: Object.freeze({
    observed: 'the directory that holds the pointer is occupied by a file (ENOTDIR), so no pointer path exists to read or release',
    remedy: 'the file occupying that directory path has to be removed or replaced on disk, and no tool here can do that',
  }),
});

const REPLACEABILITY = Object.freeze({
  writable: 'open_thread, bind_branch, reopen and create_successor each replace the pointer without reading it first, so any of them puts this ledger back on a pointer that can be released',
  unwritable: 'the directory holding the pointer is not writable, so no tool can replace the pointer; it has to be made writable on disk',
  unknown: 'whether any tool can replace the pointer could not be observed',
});

const UNWRITABLE_ERRNOS = Object.freeze(['EACCES', 'EPERM', 'EROFS']);

function raise(notice, remedy) {
  return { value: null, warning: `${notice}; ${RELEASE_SKIPPED}; ${remedy}` };
}

async function pointerReplaceability(ctx) {
  try {
    await access(dirname(await activeThreadPath(ctx)), constants.W_OK);
    return REPLACEABILITY.writable;
  } catch (error) {
    const errno = pointerSyscallErrno(error);
    return UNWRITABLE_ERRNOS.includes(errno) ? REPLACEABILITY.unwritable : REPLACEABILITY.unknown;
  }
}

async function classifyPointer(ctx, value) {
  if (value === null || isUlid(value)) return { value, warning: null };
  return raise(
    pointerNotice(POINTER_VERBS.recognise, POINTER_CONSEQUENCES.unrecognised),
    await pointerReplaceability(ctx),
  );
}

async function tolerateReadFailure(ctx, error) {
  const errno = pointerSyscallErrno(error);
  const occupied = errno !== null && Object.hasOwn(OCCUPIED_POINTERS, errno)
    ? OCCUPIED_POINTERS[errno]
    : undefined;
  if (occupied !== undefined) {
    return raise(pointerNotice(POINTER_VERBS.read, occupied.observed), occupied.remedy);
  }
  if (errno === null && !(error instanceof ActivePointerUnavailable)) throw error;
  const tolerated = await readActiveThreadOrWarn(ctx);
  if (tolerated.warning === null) return classifyPointer(ctx, tolerated.value);
  return raise(tolerated.warning, await pointerReplaceability(ctx));
}

async function attemptRead(ctx) {
  try {
    return { ok: true, value: await readActiveThread(ctx) };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function readPointerOrWarn(ctx) {
  const read = await attemptRead(ctx);
  return read.ok ? classifyPointer(ctx, read.value) : tolerateReadFailure(ctx, read.error);
}

export const TRANSITION_SUBJECTS = Object.freeze(['status', 'thread']);

function requireSubject(value) {
  if (!TRANSITION_SUBJECTS.includes(value)) {
    throw new TypeError(
      `illegalTransition: subject must be one of ${TRANSITION_SUBJECTS.join(', ')}`,
    );
  }
  return value;
}

function transitionExpectation(subject, from, to, targets) {
  if (subject === 'status') {
    return targets.length === 0
      ? `${from} is terminal and has no outgoing transition`
      : `one of ${targets.join(', ')}`;
  }
  const sources = THREAD_STATUSES.filter((status) => canTransition(status, to));
  return sources.length === 0
    ? `a thread that is not ${from}`
    : `a thread whose status is one of ${sources.join(', ')}`;
}

function transitionRepair(from, to, targets, hops) {
  if (targets.length === 0) return 'use create_successor to carry the work forward';
  if (hops.length === 0) {
    return `no single transition_thread hop leads from ${from} to ${to}, so carry the work forward with create_successor`;
  }
  return `move it to one of ${hops.join(', ')} with transition_thread, then re-send this call unchanged`;
}

export function illegalTransition(tool, field, from, to, subject) {
  const domain = requireSubject(subject);
  const targets = ALLOWED_TRANSITIONS[from] ?? [];
  const hops = targets.filter((hop) => canTransition(hop, to));
  return {
    code: 'illegal_transition',
    field: `${tool}.${field}`,
    expected: transitionExpectation(domain, from, to, targets),
    retryable: hops.length > 0,
    remedy: `illegal transition ${from} -> ${to}; ${transitionRepair(from, to, targets, hops)}`,
  };
}

const CRITERION_IDS_SHOWN = 12;

export function liveIds(thread) {
  const ids = liveCriteria(thread).map((c) => c.id);
  if (ids.length === 0) return 'no live criterion (every entry is struck)';
  const shown = ids.slice(0, CRITERION_IDS_SHOWN);
  return shown.length === ids.length ? shown.join(', ') : `${shown.join(', ')}, +${ids.length - shown.length} more`;
}

export function unknownCriterion(thread, field, id) {
  return {
    code: 'unknown_criterion',
    field,
    expected: `one of ${liveIds(thread)}`,
    example: 'c1',
    retryable: false,
    remedy: echoBetween(
      'this thread has no criterion ',
      '; re-send naming an id the thread actually carries',
      id,
    ),
  };
}

export async function knownDecisionRefs(driver) {
  const decisions = await driver.listDecisions();
  return new Set(decisions.map((d) => `${d.nnnn}-${d.slug}`));
}

export function withWarnings(result, warnings) {
  const raised = warnings
    .filter((warning) => typeof warning === 'string' && warning.length > 0)
    .map((warning) => escapeFormat(warning));
  return raised.length === 0 ? result : { ...result, warnings: raised };
}

export function isRecoveryDegraded(commitResult) {
  return commitResult != null && commitResult.degraded === true;
}

export async function commitAndReindex(driver, message) {
  const counts = await rebuildIndex(driver);
  const result = await driver.commit(message);
  return { counts, recovery_degraded: isRecoveryDegraded(result) };
}
