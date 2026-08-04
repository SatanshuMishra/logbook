import { rebuildIndex } from '../index/rebuild-index.mjs';
import { ALLOWED_TRANSITIONS } from '../model/fsm.mjs';
import { liveCriteria } from '../model/selection.mjs';

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
    remedy: `no thread is stored under ${id}; thread ids are server-assigned, so re-send with an id this ledger returned`,
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

export function illegalTransition(tool, field, from, to) {
  const targets = ALLOWED_TRANSITIONS[from] ?? [];
  const terminal = targets.length === 0;
  const repair = terminal
    ? 'use create_successor to carry the work forward'
    : `move it to one of ${targets.join(', ')} with transition_thread, then re-send this call unchanged`;
  return {
    code: 'illegal_transition',
    field: `${tool}.${field}`,
    expected: terminal
      ? `${from} is terminal and has no outgoing transition`
      : `one of ${targets.join(', ')}`,
    retryable: !terminal,
    remedy: `illegal transition ${from} -> ${to}; ${repair}`,
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
    remedy: `this thread has no criterion "${id}"; re-send naming an id the thread actually carries`,
  };
}

export async function knownDecisionRefs(driver) {
  const decisions = await driver.listDecisions();
  return new Set(decisions.map((d) => `${d.nnnn}-${d.slug}`));
}

export function isRecoveryDegraded(commitResult) {
  return commitResult != null && commitResult.degraded === true;
}

export async function commitAndReindex(driver, message) {
  const counts = await rebuildIndex(driver);
  const result = await driver.commit(message);
  return { counts, recovery_degraded: isRecoveryDegraded(result) };
}
