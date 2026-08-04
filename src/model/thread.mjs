import { newUlid } from '../util/ulid.mjs';
import { LedgerError, ToolError } from '../errors.mjs';
import { assertValidThread, THREAD_SCHEMA_VERSION } from '../schema/index.mjs';
import { CRITERION_TEXT_MAX_CHARS } from '../schema/patterns.mjs';
import { isoNow } from './clock.mjs';
import { nextCriterionId } from './criteria.mjs';

const NEW_THREAD_STATUS = 'active';
const DEFAULT_CRITERION_KIND = 'planned';

function qualify(tool, field) {
  return typeof tool === 'string' && tool.length > 0 ? `${tool}.${field}` : field;
}

function toSlug(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCriteria(input, tool) {
  const field = qualify(tool, 'completion_criteria');
  if (!Array.isArray(input) || input.length === 0) {
    throw new ToolError({
      code: 'empty_criteria',
      field,
      expected: 'an array carrying at least one completion criterion',
      example: '[{"text": "ship it"}]',
      retryable: false,
      remedy: 'a thread cannot open without a definition of done; re-send completion_criteria with at least one entry',
    });
  }
  return input.reduce((acc, item) => {
    if (typeof item?.text === 'string' && item.text.length > CRITERION_TEXT_MAX_CHARS) {
      throw new LedgerError({
        code: 'cap_exceeded',
        layer: 'cap',
        field: `${field}[${acc.length}].text`,
        expected: `at most ${CRITERION_TEXT_MAX_CHARS} characters`,
        retryable: false,
        remedy: `that criterion text is ${item.text.length} characters; shorten it to ${CRITERION_TEXT_MAX_CHARS} or fewer and re-send`,
      });
    }
    return [...acc, {
      id: nextCriterionId(acc),
      text: item.text,
      done: item.done === true,
      kind: item.kind ?? DEFAULT_CRITERION_KIND,
      struck_by: null,
    }];
  }, []);
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
  const { tool } = options;
  const { title } = fields;
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new ToolError({
      code: 'blank_parameter',
      field: qualify(tool, 'title'),
      expected: 'a string carrying at least one non-whitespace character',
      retryable: false,
      remedy: 'title arrived blank; re-send it with the wording that names this thread',
    });
  }
  const rawSlug = fields.slug;
  const slug = typeof rawSlug === 'string' && rawSlug.trim().length > 0
    ? rawSlug
    : toSlug(title);
  if (slug.length === 0) {
    throw new ToolError({
      code: 'underivable_slug',
      field: qualify(tool, 'title'),
      expected: 'a title carrying at least one ASCII letter or digit, or an explicit slug alongside it',
      example: 'ship-the-ledger',
      retryable: false,
      remedy: 'no slug can be derived from this title; re-send the same call with an explicit slug of lowercase ASCII words',
    });
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
    completion_criteria: normalizeCriteria(fields.completion_criteria, tool),
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
