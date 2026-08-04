import {
  ULID_PATTERN,
  ISO_TIMESTAMP_PATTERN,
  CRITERION_ID_PATTERN,
  CRITERION_KINDS,
  DECISION_REF_PATTERN,
  SCOPE_PATTERN,
} from './patterns.mjs';

export const THREAD_SCHEMA_VERSION = 2;

const riskItem = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'scope', 'refs'],
  properties: {
    text: { type: 'string', minLength: 1 },
    scope: { type: 'string', pattern: SCOPE_PATTERN },
    refs: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

const decisionItem = {
  type: 'object',
  additionalProperties: false,
  required: ['ref', 'title', 'scope'],
  properties: {
    ref: { type: 'string', pattern: DECISION_REF_PATTERN },
    title: { type: 'string', minLength: 1 },
    scope: { type: 'string', pattern: SCOPE_PATTERN },
  },
};

export const threadSchema = {
  $id: 'https://continuity-ledger/schema/thread.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'id',
    'slug',
    'title',
    'status',
    'parent_id',
    'predecessor_id',
    'completion_criteria',
    'vcs_ref',
    'external_refs',
    'blocked_by',
    'abandoned_reason',
    'closure_statement',
    'spine',
    'created_at',
    'updated_at',
  ],
  properties: {
    schema_version: { type: 'integer', const: THREAD_SCHEMA_VERSION },
    id: { type: 'string', pattern: ULID_PATTERN },
    slug: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['active', 'paused', 'blocked', 'done', 'abandoned'] },
    parent_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
    predecessor_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
    completion_criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'done', 'kind', 'struck_by'],
        properties: {
          id: { type: 'string', pattern: CRITERION_ID_PATTERN },
          text: { type: 'string', minLength: 1 },
          done: { type: 'boolean' },
          kind: { type: 'string', enum: [...CRITERION_KINDS] },
          struck_by: { type: ['string', 'null'], pattern: DECISION_REF_PATTERN },
        },
      },
    },
    vcs_ref: { type: ['string', 'null'] },
    external_refs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['system', 'id', 'url'],
        properties: {
          system: { type: 'string' },
          id: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
    blocked_by: { type: ['string', 'null'] },
    abandoned_reason: { type: ['string', 'null'] },
    closure_statement: { type: ['string', 'null'] },
    spine: {
      type: 'object',
      additionalProperties: false,
      required: ['active_goal', 'next_step', 'last_session', 'open_risks', 'key_decisions', 'out_of_scope'],
      properties: {
        active_goal: { type: 'string' },
        next_step: { type: 'string' },
        last_session: { type: 'string' },
        open_risks: { type: 'array', items: riskItem },
        key_decisions: { type: 'array', items: decisionItem },
        out_of_scope: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    created_at: { type: 'string', pattern: ISO_TIMESTAMP_PATTERN },
    updated_at: { type: 'string', pattern: ISO_TIMESTAMP_PATTERN },
  },
};
