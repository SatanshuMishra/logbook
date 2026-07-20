import Ajv from 'ajv'

const ULID_PATTERN = '^[0-9A-HJKMNP-TV-Z]{26}$'
const ISO_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
const SHA256_PATTERN = '^[0-9a-f]{64}$'
const NNNN_PATTERN = '^[0-9]{4}$'

const mapEnvelope = (entryItems) => ({
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'store', 'entries'],
  properties: {
    schema_version: { const: 1 },
    store: { type: 'string', minLength: 1 },
    entries: { type: 'array', items: entryItems },
  },
})

export const threadMapSchema = mapEnvelope({
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'id', 'created_at', 'created_at_rung', 'title'],
  properties: {
    slug: { type: 'string', minLength: 1 },
    id: { type: 'string', pattern: ULID_PATTERN },
    created_at: { type: 'string', pattern: ISO_PATTERN },
    created_at_rung: { enum: [1, 2, 3, 4] },
    title: { type: 'string' },
  },
})

export const decisionMapSchema = mapEnvelope({
  type: 'object',
  additionalProperties: false,
  required: ['old_filename', 'nnnn', 'slug', 'thread_id'],
  properties: {
    old_filename: { type: 'string', minLength: 1 },
    nnnn: { type: 'string', pattern: NNNN_PATTERN },
    slug: { type: 'string', minLength: 1 },
    thread_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
  },
})

export const sessionMapSchema = mapEnvelope({
  type: 'object',
  additionalProperties: false,
  required: ['old_path', 'new_path', 'thread_id', 'lossy_time'],
  properties: {
    old_path: { type: 'string', minLength: 1 },
    new_path: { type: 'string', minLength: 1 },
    thread_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
    lossy_time: { type: 'boolean' },
  },
})

export const reviewQueueSchema = mapEnvelope({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'record_type', 'source_path', 'flag_class', 'reason', 'suggestion', 'resolution_status'],
  properties: {
    id: { type: 'string', pattern: ULID_PATTERN },
    record_type: { enum: ['thread', 'decision', 'session', 'binding', 'artifact', 'projectmd'] },
    source_path: { type: 'string', minLength: 1 },
    flag_class: { enum: ['LOSSY', 'MANUAL', 'HALT'] },
    reason: { type: 'string', minLength: 1 },
    suggestion: { type: 'string' },
    resolution_status: { enum: ['open', 'resolved', 'deferred'] },
  },
})

export const planArtifactSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version', 'tool_version', 'store_path', 'project_key', 'backend',
    'source_inventory_hash', 'baseline_counts', 'source_checksums',
    'thread_map', 'decision_map', 'session_map', 'binding_plan',
    'cross_ref_rewrites', 'review_queue', 'flags', 'verification',
  ],
  properties: {
    schema_version: { const: 1 },
    tool_version: { type: 'string', minLength: 1 },
    store_path: { type: 'string', minLength: 1 },
    project_key: { type: 'string', minLength: 1 },
    backend: { enum: ['orphan-branch', 'local'] },
    source_inventory_hash: { type: 'string', pattern: SHA256_PATTERN },
    baseline_counts: {
      type: 'object',
      additionalProperties: false,
      required: ['threads', 'decisions', 'sessions', 'bindings'],
      properties: {
        threads: { type: 'integer', minimum: 0 },
        decisions: { type: 'integer', minimum: 0 },
        sessions: { type: 'integer', minimum: 0 },
        bindings: { type: 'integer', minimum: 0 },
      },
    },
    source_checksums: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'sha256'],
        properties: {
          path: { type: 'string', minLength: 1 },
          sha256: { type: 'string', pattern: SHA256_PATTERN },
        },
      },
    },
    thread_map: threadMapSchema,
    decision_map: decisionMapSchema,
    session_map: sessionMapSchema,
    binding_plan: { type: 'array', items: { type: 'object' } },
    cross_ref_rewrites: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['surface', 'old', 'new', 'class', 'status'],
        properties: {
          surface: { type: 'integer', minimum: 1, maximum: 15 },
          old: { type: 'string' },
          new: { type: 'string' },
          class: { enum: ['PARSED', 'DERIVED', 'MANUAL', 'SYNTHESIZED'] },
          status: { enum: ['resolved', 'halt'] },
        },
      },
    },
    review_queue: reviewQueueSchema,
    flags: {
      type: 'object',
      additionalProperties: false,
      required: ['lossy', 'manual', 'halt'],
      properties: {
        lossy: { type: 'integer', minimum: 0 },
        manual: { type: 'integer', minimum: 0 },
        halt: { type: 'integer', minimum: 0 },
      },
    },
    verification: {
      type: 'object',
      additionalProperties: false,
      required: ['v1', 'v2', 'v3', 'v4', 'v5'],
      properties: {
        v1: { type: ['object', 'null'] },
        v2: { type: ['object', 'null'] },
        v3: { type: ['object', 'null'] },
        v4: { type: ['object', 'null'] },
        v5: { type: ['object', 'null'] },
      },
    },
  },
}

const ajv = new Ajv({ allErrors: true, strict: false })
const compiled = {
  planArtifact: ajv.compile(planArtifactSchema),
  threadMap: ajv.compile(threadMapSchema),
  decisionMap: ajv.compile(decisionMapSchema),
  sessionMap: ajv.compile(sessionMapSchema),
  reviewQueue: ajv.compile(reviewQueueSchema),
}

function formatErrors(errors) {
  return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')
}

function makeValidator(kind, label) {
  const check = compiled[kind]
  return (obj) => {
    if (!check(obj)) {
      throw new Error(`invalid ${label}: ${formatErrors(check.errors)}`)
    }
    return obj
  }
}

export const validatePlanArtifact = makeValidator('planArtifact', 'plan artifact')
export const validateThreadMap = makeValidator('threadMap', 'ThreadMap')
export const validateDecisionMap = makeValidator('decisionMap', 'DecisionMap')
export const validateSessionMap = makeValidator('sessionMap', 'SessionMap')
export const validateReviewQueue = makeValidator('reviewQueue', 'ReviewQueue')
