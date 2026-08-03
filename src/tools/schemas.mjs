import {
  ULID_PATTERN,
  CRITERION_ID_PATTERN,
  CRITERION_KINDS,
  CRITERION_TEXT_MAX_CHARS,
} from '../schema/patterns.mjs';

export { ULID_PATTERN, CRITERION_ID_PATTERN };

export const criteriaCreateItem = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: CRITERION_TEXT_MAX_CHARS },
    kind: { type: 'string', enum: [...CRITERION_KINDS] },
  },
};

export const criteriaToggleItem = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'done'],
  properties: {
    id: { type: 'string', pattern: CRITERION_ID_PATTERN },
    done: { type: 'boolean' },
  },
};

export const externalRefInputItem = {
  type: 'object',
  additionalProperties: false,
  required: ['system', 'id', 'url'],
  properties: {
    system: { type: 'string' },
    id: { type: 'string' },
    url: { type: 'string' },
  },
};

export const emptyInput = { type: 'object', additionalProperties: false, properties: {} };
