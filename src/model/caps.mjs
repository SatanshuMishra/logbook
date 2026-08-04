export const SPINE_CAPS = Object.freeze({
  scalarFieldMaxChars: 500,
  arrayMaxItems: 20,
  arrayItemMaxChars: 300,
});

export const COUNT_CAPPED_ARRAY_FIELDS = Object.freeze(['open_risks', 'out_of_scope']);

const SCALAR_FIELDS = Object.freeze(['status', 'active_goal', 'next_step']);
const ARRAY_FIELDS = Object.freeze(['open_risks', 'key_decisions', 'out_of_scope']);

export class CapViolationError extends Error {
  constructor(message, fields) {
    super(message);
    this.name = 'CapViolationError';
    this.fields = Object.freeze(Array.isArray(fields) ? [...fields] : [fields]);
    this.field = this.fields[0];
  }
}

function collectViolations(spine) {
  const violations = [];
  for (const field of SCALAR_FIELDS) {
    const value = spine[field];
    if (typeof value === 'string' && value.length > SPINE_CAPS.scalarFieldMaxChars) {
      violations.push({ field, detail: `spine.${field} exceeds ${SPINE_CAPS.scalarFieldMaxChars} chars` });
    }
  }
  for (const field of COUNT_CAPPED_ARRAY_FIELDS) {
    const arr = spine[field];
    if (Array.isArray(arr) && arr.length > SPINE_CAPS.arrayMaxItems) {
      violations.push({ field, detail: `spine.${field} exceeds ${SPINE_CAPS.arrayMaxItems} items` });
    }
  }
  for (const field of ARRAY_FIELDS) {
    const arr = spine[field];
    const overCapItem = Array.isArray(arr)
      && arr.some((item) => typeof item === 'string' && item.length > SPINE_CAPS.arrayItemMaxChars);
    if (overCapItem) {
      violations.push({ field, detail: `spine.${field} item exceeds ${SPINE_CAPS.arrayItemMaxChars} chars` });
    }
  }
  return violations;
}

export function assertSpineCaps(spine) {
  if (!spine || typeof spine !== 'object') {
    throw new CapViolationError('assertSpineCaps: spine must be an object', ['spine']);
  }
  const violations = collectViolations(spine);
  if (violations.length > 0) {
    throw new CapViolationError(
      violations.map((v) => v.detail).join('; '),
      [...new Set(violations.map((v) => v.field))],
    );
  }
  return spine;
}
