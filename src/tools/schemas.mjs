import { ULID_PATTERN } from '../schema/patterns.mjs';

export { ULID_PATTERN };

export const criteriaCreateItem = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: {
    text: { type: 'string', minLength: 1 },
    done: { type: 'boolean' },
  },
};

export const criteriaToggleItem = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'done'],
  properties: {
    text: { type: 'string', minLength: 1 },
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
