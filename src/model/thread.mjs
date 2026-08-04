import { newUlid } from '../util/ulid.mjs';
import { assertValidThread, THREAD_SCHEMA_VERSION } from '../schema/index.mjs';
import { isoNow } from './clock.mjs';
import { nextCriterionId } from './criteria.mjs';

const NEW_THREAD_STATUS = 'active';
const DEFAULT_CRITERION_KIND = 'planned';

function toSlug(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCriteria(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new TypeError('newThread: completion_criteria must list at least one criterion');
  }
  return input.reduce((acc, item) => [...acc, {
    id: nextCriterionId(acc),
    text: item.text,
    done: item.done === true,
    kind: item.kind ?? DEFAULT_CRITERION_KIND,
    struck_by: null,
  }], []);
}

function emptySpine() {
  return {
    active_goal: '',
    next_step: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: [],
  };
}

export function newThread(fields = {}, options = {}) {
  const { title } = fields;
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new TypeError('newThread: title must be a non-empty string');
  }
  const rawSlug = fields.slug;
  const slug = typeof rawSlug === 'string' && rawSlug.trim().length > 0
    ? rawSlug
    : toSlug(title);
  if (slug.length === 0) {
    throw new Error('newThread: could not derive a slug from title; pass an explicit slug');
  }
  const timestamp = isoNow(options.now);
  const record = {
    schema_version: THREAD_SCHEMA_VERSION,
    id: typeof options.id === 'string' ? options.id : newUlid(),
    slug,
    title,
    status: NEW_THREAD_STATUS,
    parent_id: fields.parent_id ?? null,
    predecessor_id: fields.predecessor_id ?? null,
    completion_criteria: normalizeCriteria(fields.completion_criteria),
    vcs_ref: fields.vcs_ref ?? null,
    external_refs: Array.isArray(fields.external_refs) ? [...fields.external_refs] : [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: emptySpine(),
    created_at: timestamp,
    updated_at: timestamp,
  };
  return assertValidThread(record);
}
