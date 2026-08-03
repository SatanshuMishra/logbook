import { THREAD_SCOPE } from '../schema/patterns.mjs';

export function liveCriteria(thread) {
  const criteria = thread && Array.isArray(thread.completion_criteria)
    ? thread.completion_criteria
    : [];
  return criteria.filter((c) => c && typeof c === 'object' && (c.struck_by ?? null) === null);
}

export function currentCriterion(thread) {
  return liveCriteria(thread).find((c) => c.done !== true) ?? null;
}

export function resolveWriteScope(thread) {
  const live = liveCriteria(thread);
  if (live.length === 0) return THREAD_SCOPE;
  const current = currentCriterion(thread) ?? live[live.length - 1];
  return typeof current.id === 'string' ? current.id : THREAD_SCOPE;
}
