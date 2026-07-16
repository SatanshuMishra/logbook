export const CLASSIFICATION_RANK = Object.freeze({ CRITICAL: 3, WARNING: 2, COMPLETE: 1 });

const BOOLEAN_FIELDS = [
  'branch_exists',
  'first_commit_present',
  'merged',
  'squash_merged',
  'force_push_detected',
  'diverged_from_upstream',
];

function assertBinding(binding) {
  if (
    !binding ||
    typeof binding !== 'object' ||
    typeof binding.id !== 'string' ||
    typeof binding.thread_id !== 'string'
  ) {
    throw new Error('classifyObservation: binding must carry a string id and thread_id');
  }
}

function assertObservation(o) {
  if (!o || typeof o !== 'object') {
    throw new Error('classifyObservation: malformed BranchObservation');
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof o[field] !== 'boolean') {
      throw new Error('classifyObservation: malformed BranchObservation');
    }
  }
  if (typeof o.ahead !== 'number' || typeof o.behind !== 'number') {
    throw new Error('classifyObservation: malformed BranchObservation');
  }
  if (!Array.isArray(o.key_files_deleted) || !Array.isArray(o.key_files_modified)) {
    throw new Error('classifyObservation: malformed BranchObservation');
  }
}

function maxClassification(signals) {
  let best = null;
  let bestRank = 0;
  for (const s of signals) {
    const rank = CLASSIFICATION_RANK[s.classification];
    if (rank > bestRank) {
      bestRank = rank;
      best = s.classification;
    }
  }
  return best;
}

export function classifyObservation(binding, observation) {
  assertBinding(binding);
  assertObservation(observation);

  const o = observation;
  const signals = [];

  if (!o.first_commit_present) {
    signals.push({ code: 'head-missing', classification: 'CRITICAL', detail: binding.first_commit ?? null });
  }
  if (o.force_push_detected) {
    signals.push({ code: 'force-push', classification: 'CRITICAL', detail: 'non-fast-forward rewrite' });
  }
  if (o.key_files_deleted.length > 0) {
    signals.push({ code: 'key-file-deleted', classification: 'CRITICAL', detail: o.key_files_deleted.join(', ') });
  }
  if (o.branch_exists && o.diverged_from_upstream) {
    signals.push({ code: 'not-ancestor', classification: 'WARNING', detail: `diverged from origin/${binding.branch}` });
  }
  if (o.ahead > 0 || o.behind > 0) {
    signals.push({ code: 'divergence', classification: 'WARNING', detail: `ahead ${o.ahead}, behind ${o.behind}` });
  }
  if (o.key_files_modified.length > 0) {
    signals.push({ code: 'key-file-modified', classification: 'WARNING', detail: o.key_files_modified.join(', ') });
  }
  if (o.squash_merged) {
    signals.push({ code: 'squash-merged', classification: 'COMPLETE', detail: 'squash-merged' });
  }
  if (o.merged || o.squash_merged || !o.branch_exists) {
    const landed = o.merged || o.squash_merged;
    signals.push({
      code: 'branch-gone',
      classification: landed ? 'COMPLETE' : 'WARNING',
      detail: landed ? 'merged' : 'deleted',
    });
  }

  if (signals.length === 0) {
    return null;
  }

  return {
    binding_id: binding.id,
    thread_id: binding.thread_id,
    repo: binding.repo,
    branch: binding.branch,
    classification: maxClassification(signals),
    signals,
  };
}
