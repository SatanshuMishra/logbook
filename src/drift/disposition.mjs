import { isTerminal, liveCriteria } from '../model/index.mjs';

function hasCode(entry, code) {
  return entry.signals.some((s) => s.code === code);
}

function hasBranchGoneDetail(entry, detail) {
  return entry.signals.some((s) => s.code === 'branch-gone' && s.detail === detail);
}

function dodReady(thread) {
  const criteria = liveCriteria(thread);
  return criteria.length > 0 && criteria.every((c) => c && c.done === true);
}

export function disposeBinding(entry, thread) {
  if (!entry || !Array.isArray(entry.signals)) {
    throw new TypeError('disposeBinding: entry must be a DriftEntry with a signals array');
  }

  const terminal = thread ? isTerminal(thread.status) : false;
  const merged = hasCode(entry, 'squash-merged') || hasBranchGoneDetail(entry, 'merged');
  const orphaned = hasBranchGoneDetail(entry, 'deleted');

  const identity = { binding_id: entry.binding_id, thread_id: entry.thread_id };

  if (merged) {
    return {
      ...identity,
      action: 'mark-merged',
      binding_status: 'merged',
      closed_reason: 'merged',
      thread_recommendation: terminal ? 'none' : 'complete',
      dod_ready: dodReady(thread),
      reason: 'branch landed on the integration base',
    };
  }
  if (orphaned) {
    return {
      ...identity,
      action: 'mark-orphaned',
      binding_status: 'orphaned',
      closed_reason: 'deleted',
      thread_recommendation: terminal ? 'none' : 'reopen-paused',
      dod_ready: false,
      reason: 'branch deleted without a detectable merge',
    };
  }
  return {
    ...identity,
    action: 're-verify',
    binding_status: null,
    closed_reason: null,
    thread_recommendation: 're-verify',
    dod_ready: false,
    reason: 'drift detected; re-verify against HEAD',
  };
}
