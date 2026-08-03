import { THREAD_SCOPE, DETOUR_KIND } from '../schema/patterns.mjs';

export function liveCriteria(thread) {
  const criteria = thread && Array.isArray(thread.completion_criteria)
    ? thread.completion_criteria
    : [];
  return criteria.filter((c) => c && typeof c === 'object' && (c.struck_by ?? null) === null);
}

export function resolveWriteScope(thread) {
  const live = liveCriteria(thread);
  if (live.length === 0) return THREAD_SCOPE;
  const current = live.find((c) => c.done !== true) ?? live[live.length - 1];
  return typeof current.id === 'string' ? current.id : THREAD_SCOPE;
}

export function criteriaProgress(thread) {
  const live = liveCriteria(thread);
  const planned = live.filter((c) => c.kind !== DETOUR_KIND);
  return {
    done: planned.filter((c) => c.done === true).length,
    total: planned.length,
    detoursOpen: live.filter((c) => c.kind === DETOUR_KIND && c.done !== true).length,
  };
}
