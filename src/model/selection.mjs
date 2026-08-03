import { THREAD_SCOPE } from '../schema/patterns.mjs';

const PLANNED_KIND = 'planned';
const DETOUR_KIND = 'detour';

export const SELECTION_STATES = Object.freeze(['in-progress', 'ready-to-close']);

export function liveCriteria(thread) {
  const criteria = thread && Array.isArray(thread.completion_criteria)
    ? thread.completion_criteria
    : [];
  return criteria.filter((c) => c && typeof c === 'object' && (c.struck_by ?? null) === null);
}

function firstOpen(live) {
  return live.find((c) => c.done !== true) ?? null;
}

function anchorCriterion(live) {
  return firstOpen(live) ?? live[live.length - 1] ?? null;
}

export function resolveWriteScope(thread) {
  const anchor = anchorCriterion(liveCriteria(thread));
  return anchor && typeof anchor.id === 'string' ? anchor.id : THREAD_SCOPE;
}

export function selectCurrent(thread) {
  const live = liveCriteria(thread);
  const current = firstOpen(live);
  const anchor = current ?? live[live.length - 1] ?? null;
  const planned = live.filter((c) => c.kind === PLANNED_KIND);
  const visibleScopes = new Set([THREAD_SCOPE]);
  if (anchor && typeof anchor.id === 'string') {
    visibleScopes.add(anchor.id);
  }
  return {
    current,
    state: current === null ? 'ready-to-close' : 'in-progress',
    done: planned.filter((c) => c.done === true).length,
    total: planned.length,
    detoursOpen: live.filter((c) => c.kind === DETOUR_KIND && c.done !== true).length,
    visibleScopes,
  };
}
