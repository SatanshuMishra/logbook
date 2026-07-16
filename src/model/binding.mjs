import { newUlid } from '../util/ulid.mjs';
import { assertValidBinding } from '../schema/index.mjs';
import { isoNow } from './clock.mjs';

function requireNonEmpty(fn, name, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fn}: ${name} must be a non-empty string`);
  }
  return value;
}

export function newBinding(fields = {}, options = {}) {
  requireNonEmpty('newBinding', 'thread_id', fields.thread_id);
  requireNonEmpty('newBinding', 'repo', fields.repo);
  requireNonEmpty('newBinding', 'branch', fields.branch);
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
