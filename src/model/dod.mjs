export function checkDefinitionOfDone(thread) {
  const criteria = thread && Array.isArray(thread.completion_criteria)
    ? thread.completion_criteria
    : [];
  if (criteria.length === 0) {
    return { ok: false, reason: 'completion_criteria must be non-empty for done' };
  }
  if (!criteria.every((item) => item && item.done === true)) {
    return { ok: false, reason: 'every completion_criteria entry must be done:true for done' };
  }
  const closure = thread ? thread.closure_statement : null;
  if (typeof closure !== 'string' || closure.trim().length === 0) {
    return { ok: false, reason: 'closure_statement must be non-empty for done' };
  }
  return { ok: true };
}
