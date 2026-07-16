import { newUlid } from '../util/ulid.mjs';
import { assertValidThread } from '../schema/index.mjs';
import { isoNow } from './clock.mjs';

const NEW_THREAD_STATUS = 'active';

function toSlug(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCriteria(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((item) => ({ text: item.text, done: item.done === true }));
}

function emptySpine(status) {
  return {
    status,
    active_goal: '',
    next_step: '',
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
    schema_version: 1,
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
    spine: emptySpine(NEW_THREAD_STATUS),
    created_at: timestamp,
    updated_at: timestamp,
  };
  return assertValidThread(record);
}
