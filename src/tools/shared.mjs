import { echoBetween, escapeFormat } from '../errors.mjs';
import { rebuildIndex } from '../index/rebuild-index.mjs';
import { ALLOWED_TRANSITIONS, THREAD_STATUSES, canTransition } from '../model/fsm.mjs';
import { liveCriteria } from '../model/selection.mjs';
import {
  pointerSyscallErrno,
  readActiveThread,
  readActiveThreadOrWarn,
} from '../util/active-thread.mjs';

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

const ABSENT_POINTER_ERRNOS = Object.freeze(['ENOTDIR', 'EISDIR']);

export const NO_POINTER = Object.freeze({ value: null, warning: null });

const RELEASE_SKIPPED = 'no pointer was released';

const POINTER_RESCUE = 'open_thread, bind_branch, reopen and create_successor each replace the pointer without reading it first, so any of them puts this ledger back on a pointer that can be released';

function occupiedPointer(errno) {
  return `active-thread pointer not read: the pointer path is occupied by something that is not a readable file (${errno}), so nothing can be read or released from it`;
}

function raise(value, notice) {
  return { value, warning: `${notice}; ${RELEASE_SKIPPED}; ${POINTER_RESCUE}` };
}

export async function readPointerOrWarn(ctx) {
  try {
    return { value: await readActiveThread(ctx), warning: null };
  } catch (error) {
    const errno = pointerSyscallErrno(error);
    if (errno === null) throw error;
    if (ABSENT_POINTER_ERRNOS.includes(errno)) return raise(null, occupiedPointer(errno));
    const tolerated = await readActiveThreadOrWarn(ctx);
    if (tolerated.warning === null) return tolerated;
    return raise(tolerated.value, tolerated.warning);
  }
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
