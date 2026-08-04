import { THREAD_SCOPE, DETOUR_KIND } from '../schema/patterns.mjs';

export const SELECTION_STATES = Object.freeze(['in-progress', 'ready-to-close']);

export function liveCriteria(thread) {
  const criteria = thread && Array.isArray(thread.completion_criteria)
    ? thread.completion_criteria
    : [];
  return criteria.filter((c) => c && typeof c === 'object' && (c.struck_by ?? null) === null);
}

export function currentCriterion(thread) {
  return liveCriteria(thread).find((c) => c.done !== true) ?? null;
}

function anchorCriterion(live) {
  return live.find((c) => c.done !== true) ?? live[live.length - 1] ?? null;
}

export function resolveWriteScope(thread) {
  const anchor = anchorCriterion(liveCriteria(thread));
  return anchor && typeof anchor.id === 'string' ? anchor.id : THREAD_SCOPE;
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

export function selectCurrent(thread) {
  const live = liveCriteria(thread);
  const current = currentCriterion(thread);
  const anchor = anchorCriterion(live);
  const visibleScopes = new Set([THREAD_SCOPE]);
  if (anchor && typeof anchor.id === 'string') {
    visibleScopes.add(anchor.id);
  }
  return {
    ...criteriaProgress(thread),
    current,
    state: current === null ? 'ready-to-close' : 'in-progress',
    visibleScopes,
  };
}
