import { THREAD_SCHEMA_VERSION } from './thread.schema.mjs';
import { THREAD_SCOPE, LEGACY_SCOPE } from './patterns.mjs';

const LEGACY_SCHEMA_VERSION = 1;
const LEGACY_CRITERION_KIND = 'planned';
const DECISION_REF_SPLIT = /^([0-9]{4})-(.+)$/;

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

function unkebab(slug) {
  const spaced = slug.replace(/-+/g, ' ').trim();
  if (spaced.length === 0) return slug;
  return spaced[0].toUpperCase() + spaced.slice(1);
}

function upcastRisk(item, index) {
  if (typeof item !== 'string') {
    throw new TypeError(
      `upcastThread: spine.open_risks[${index}] must be a string, received ${JSON.stringify(item)}`,
    );
  }
  return { text: item, scope: THREAD_SCOPE, refs: [] };
}

function upcastDecision(item, index) {
  if (typeof item !== 'string') {
    throw new TypeError(
      `upcastThread: spine.key_decisions[${index}] must be a string, received ${JSON.stringify(item)}`,
    );
  }
  const match = DECISION_REF_SPLIT.exec(item);
  return {
    ref: item,
    title: unkebab(match ? match[2] : item),
    scope: LEGACY_SCOPE,
  };
}

function upcastSpine(spine) {
  if (!isPlainObject(spine)) {
    throw new TypeError(
      `upcastThread: spine must be an object, received ${JSON.stringify(spine)}`,
    );
  }
  const { status: _status, ...rest } = spine;
  return {
    ...rest,
    last_session: typeof spine.last_session === 'string' ? spine.last_session : '',
    open_risks: Array.isArray(spine.open_risks) ? spine.open_risks.map(upcastRisk) : [],
    key_decisions: Array.isArray(spine.key_decisions) ? spine.key_decisions.map(upcastDecision) : [],
    out_of_scope: Array.isArray(spine.out_of_scope) ? [...spine.out_of_scope] : [],
  };
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
    spine: upcastSpine(record.spine),
  };
}
