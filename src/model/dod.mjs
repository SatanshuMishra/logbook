import { liveCriteria } from './selection.mjs';

export function checkDefinitionOfDone(thread) {
  const criteria = liveCriteria(thread);
  if (criteria.length === 0) {
    return { ok: false, reason: 'completion_criteria must list at least one un-struck entry for done' };
  }
  if (!criteria.every((item) => item && item.done === true)) {
    return { ok: false, reason: 'every un-struck completion_criteria entry must be done:true for done' };
  }
  const closure = thread ? thread.closure_statement : null;
  if (typeof closure !== 'string' || closure.trim().length === 0) {
    return { ok: false, reason: 'closure_statement must be non-empty for done' };
  }
  return { ok: true };
}
