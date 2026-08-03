import {
  ULID_PATTERN,
  CRITERION_ID_PATTERN,
  CRITERION_KINDS,
  CRITERION_TEXT_MAX_CHARS,
  DECISION_REF_PATTERN,
  WRITABLE_SCOPE_PATTERN,
} from '../schema/patterns.mjs';

export { ULID_PATTERN, CRITERION_ID_PATTERN, WRITABLE_SCOPE_PATTERN };

export const riskInputItem = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: {
    text: { type: 'string', minLength: 1 },
    scope: { type: 'string', pattern: WRITABLE_SCOPE_PATTERN },
    refs: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

export const decisionInputItem = {
  type: 'object',
  additionalProperties: false,
  required: ['ref', 'title'],
  properties: {
    ref: { type: 'string', pattern: DECISION_REF_PATTERN },
    title: { type: 'string', minLength: 1 },
    scope: { type: 'string', pattern: WRITABLE_SCOPE_PATTERN },
  },
};

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
