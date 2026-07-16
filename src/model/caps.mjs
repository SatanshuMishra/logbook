export const SPINE_CAPS = Object.freeze({
  scalarFieldMaxChars: 500,
  arrayMaxItems: 20,
  arrayItemMaxChars: 300,
});

export const COUNT_CAPPED_ARRAY_FIELDS = Object.freeze(['open_risks', 'out_of_scope']);

const SCALAR_FIELDS = Object.freeze(['status', 'active_goal', 'next_step']);
const ARRAY_FIELDS = Object.freeze(['open_risks', 'key_decisions', 'out_of_scope']);

export class CapViolationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'CapViolationError';
    this.field = field;
  }
}

export function assertSpineCaps(spine) {
  if (!spine || typeof spine !== 'object') {
    throw new CapViolationError('assertSpineCaps: spine must be an object', 'spine');
  }
  for (const field of SCALAR_FIELDS) {
    const value = spine[field];
    if (typeof value === 'string' && value.length > SPINE_CAPS.scalarFieldMaxChars) {
      throw new CapViolationError(
        `spine.${field} exceeds ${SPINE_CAPS.scalarFieldMaxChars} chars`,
        field,
      );
    }
  }
  for (const field of COUNT_CAPPED_ARRAY_FIELDS) {
    const arr = spine[field];
    if (Array.isArray(arr) && arr.length > SPINE_CAPS.arrayMaxItems) {
      throw new CapViolationError(
        `spine.${field} exceeds ${SPINE_CAPS.arrayMaxItems} items`,
        field,
      );
    }
  }
  for (const field of ARRAY_FIELDS) {
    const arr = spine[field];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && item.length > SPINE_CAPS.arrayItemMaxChars) {
          throw new CapViolationError(
            `spine.${field} item exceeds ${SPINE_CAPS.arrayItemMaxChars} chars`,
            field,
          );
        }
      }
    }
  }
  return spine;
}
