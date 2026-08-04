import { newUlid } from '../util/ulid.mjs';
import { ToolError } from '../errors.mjs';
import { assertValidBinding } from '../schema/index.mjs';
import { isoNow } from './clock.mjs';

function requireNonEmpty(tool, name, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolError({
      code: 'blank_parameter',
      field: typeof tool === 'string' && tool.length > 0 ? `${tool}.${name}` : name,
      expected: 'a string carrying at least one non-whitespace character',
      retryable: false,
      remedy: `${name} arrived blank; re-send it with the value it should bind`,
    });
  }
  return value;
}

export function newBinding(fields = {}, options = {}) {
  const { tool } = options;
  requireNonEmpty(tool, 'thread_id', fields.thread_id);
  requireNonEmpty(tool, 'repo', fields.repo);
  requireNonEmpty(tool, 'branch', fields.branch);
  const record = {
    id: typeof options.id === 'string' ? options.id : newUlid(),
    thread_id: fields.thread_id,
    repo: fields.repo,
    branch: fields.branch,
    status: 'active',
    created_at: isoNow(options.now),
    closed_at: null,
    closed_reason: null,
    first_commit: fields.first_commit ?? null,
    trailer_present: fields.trailer_present === true,
  };
  return assertValidBinding(record);
}
