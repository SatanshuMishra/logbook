import { THREAD_SCHEMA_VERSION } from './thread.schema.mjs';

const LEGACY_SCHEMA_VERSION = 1;
const LEGACY_CRITERION_KIND = 'planned';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function upcastCriterion(item, index) {
  if (!isPlainObject(item)) {
    throw new TypeError(
      `upcastThread: completion_criteria[${index}] must be an object, received ${JSON.stringify(item)}`,
    );
  }
  return {
    id: `c${index + 1}`,
    text: item.text,
    done: item.done === true,
    kind: LEGACY_CRITERION_KIND,
    struck_by: null,
  };
}

function upcastCriteria(criteria) {
  if (!Array.isArray(criteria)) return [];
  return criteria.map(upcastCriterion);
}

export function upcastThread(record) {
  if (record === null || record === undefined) return null;
  if (!isPlainObject(record)) {
    throw new TypeError('upcastThread: record must be an object or null');
  }
  if (record.schema_version !== LEGACY_SCHEMA_VERSION) return record;
  return {
    ...record,
    schema_version: THREAD_SCHEMA_VERSION,
    completion_criteria: upcastCriteria(record.completion_criteria),
  };
}
