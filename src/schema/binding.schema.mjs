import { ULID_PATTERN, ISO_TIMESTAMP_PATTERN } from './patterns.mjs';

export const bindingSchema = {
  $id: 'https://continuity-ledger/schema/binding.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'thread_id',
    'repo',
    'branch',
    'status',
    'created_at',
    'closed_at',
    'closed_reason',
    'first_commit',
    'trailer_present',
  ],
  properties: {
    id: { type: 'string', pattern: ULID_PATTERN },
    thread_id: { type: 'string', pattern: ULID_PATTERN },
    repo: { type: 'string', minLength: 1 },
    branch: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['active', 'merged', 'orphaned', 'abandoned'] },
    created_at: { type: 'string', pattern: ISO_TIMESTAMP_PATTERN },
    closed_at: { type: ['string', 'null'] },
    closed_reason: {
      type: ['string', 'null'],
      enum: ['merged', 'deleted', 'abandoned', 'superseded', null],
    },
    first_commit: { type: ['string', 'null'] },
    trailer_present: { type: 'boolean' },
  },
};
