import { clip, collapse } from '../errors.mjs';
import {
  ULID_PATTERN,
  ISO_TIMESTAMP_PATTERN,
  CRITERION_ID_PATTERN,
  DECISION_REF_PATTERN,
  DECISION_SLUG_PATTERN,
  DECISION_NUMBER_PATTERN,
  SCOPE_PATTERN,
  WRITABLE_SCOPE_PATTERN,
} from './patterns.mjs';

const RECEIVED_MAX_CHARS = 24;
const WRAPPER_KEYWORDS = Object.freeze(['if', 'anyOf', 'oneOf', 'allOf', 'not']);
const BRANCH_KEYWORDS = Object.freeze(['anyOf', 'oneOf']);
const DISCRIMINATOR_KEYWORDS = Object.freeze(['const', 'enum']);

export const PATTERN_EXAMPLES = Object.freeze({
  [ULID_PATTERN]: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  [ISO_TIMESTAMP_PATTERN]: '2026-08-04T09:00:00Z',
  [CRITERION_ID_PATTERN]: 'c1',
  [DECISION_REF_PATTERN]: '0007-adopt-the-ledger',
  [DECISION_SLUG_PATTERN]: 'adopt-the-ledger',
  [DECISION_NUMBER_PATTERN]: '0007',
  [SCOPE_PATTERN]: 'thread',
  [WRITABLE_SCOPE_PATTERN]: 'c1',
});

export function toFieldPath(instancePath) {
  if (typeof instancePath !== 'string' || instancePath.length === 0) return '';
  return instancePath
    .slice(1)
    .split('/')
    .reduce((acc, token) => {
      if (/^[0-9]+$/.test(token)) return `${acc}[${token}]`;
      return acc === '' ? token : `${acc}.${token}`;
    }, '');
}

function joinField(base, key) {
  if (!base) return String(key);
  return `${base}.${key}`;
}

function qualify(prefix, field) {
  if (!prefix) return field || '(root)';
  return field ? `${prefix}.${field}` : prefix;
}

function quoteList(values) {
  return values.map((value) => JSON.stringify(value)).join(', ');
}

function describeReceived(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(clip(value, RECEIVED_MAX_CHARS));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return 'an object';
}

function lengthExpectation(keyword, limit) {
  const unit = keyword === 'minItems' || keyword === 'maxItems' ? 'item' : 'character';
  const plural = limit === 1 ? unit : `${unit}s`;
  const bound = keyword === 'minItems' || keyword === 'minLength' ? 'at least' : 'at most';
  return `${bound} ${limit} ${plural}`;
}

function projectOne(error, prefix) {
  const path = toFieldPath(error.instancePath);
  const params = error.params ?? {};
  switch (error.keyword) {
    case 'required':
      return {
        code: 'missing_parameter',
        field: qualify(prefix, joinField(path, params.missingProperty)),
        expected: 'required, but absent from the call',
        retryable: false,
        remedy: `the parameter did not arrive; re-emit the call with ${params.missingProperty} included`,
      };
    case 'additionalProperties': {
      const named = JSON.stringify(String(params.additionalProperty));
      return {
        code: 'unexpected_parameter',
        field: qualify(prefix, joinField(path, named)),
        expected: 'not accepted by this call',
        retryable: false,
        remedy: `remove ${named} and re-send`,
      };
    }
    case 'enum':
      return {
        code: 'invalid_enum',
        field: qualify(prefix, path),
        expected: `one of ${quoteList(params.allowedValues ?? [])}`,
        retryable: false,
        remedy: `${path || 'the value'} was ${describeReceived(error.data)}; re-send with one of the accepted values`,
      };
    case 'const':
      return {
        code: 'invalid_const',
        field: qualify(prefix, path),
        expected: `exactly ${JSON.stringify(params.allowedValue)}`,
        retryable: false,
        remedy: `${path || 'the value'} was ${describeReceived(error.data)}; re-send the single accepted value`,
      };
    case 'pattern':
      return {
        code: 'invalid_pattern',
        field: qualify(prefix, path),
        expected: `a string matching ${params.pattern}`,
        example: PATTERN_EXAMPLES[params.pattern] ?? null,
        retryable: false,
        remedy: `${path || 'the value'} was ${describeReceived(error.data)}; re-send a value matching that pattern`,
      };
    case 'type':
      return {
        code: 'invalid_type',
        field: qualify(prefix, path),
        expected: `type ${[params.type].flat().join(' or ')}`,
        retryable: false,
        remedy: `${path || 'the value'} was ${describeReceived(error.data)}; re-send it with the stated type`,
      };
    case 'minLength':
    case 'maxLength':
    case 'minItems':
    case 'maxItems':
      return {
        code: 'invalid_length',
        field: qualify(prefix, path),
        expected: lengthExpectation(error.keyword, params.limit),
        retryable: false,
        remedy: `${path || 'the value'} is outside the accepted size; re-send it within the stated bound`,
      };
    default:
      return {
        code: 'invalid_value',
        field: qualify(prefix, path),
        expected: collapse(error.message ?? 'a value the schema accepts'),
        retryable: false,
        remedy: `correct ${path || 'the value'} and re-send`,
      };
  }
}

function mergeTypeAlternatives(problems) {
  return problems.reduce((acc, problem) => {
    const priorIndex = acc.findIndex(
      (seen) => seen.field === problem.field && seen.code === problem.code,
    );
    if (priorIndex === -1) return [...acc, problem];
    const prior = acc[priorIndex];
    if (problem.code !== 'invalid_type' || prior.expected === problem.expected) return acc;
    const alternatives = [prior.expected, problem.expected]
      .map((text) => text.replace(/^type /, ''))
      .join(' or ');
    return acc.map((seen, index) => (
      index === priorIndex ? { ...seen, expected: `type ${alternatives}` } : seen
    ));
  }, []);
}

function instanceDepth(instancePath) {
  return typeof instancePath === 'string' && instancePath.length > 0
    ? instancePath.split('/').length - 1
    : 0;
}

function containerPaths(errors) {
  return new Set(
    errors
      .filter((error) => BRANCH_KEYWORDS.includes(error.keyword) && typeof error.schemaPath === 'string')
      .map((error) => error.schemaPath),
  );
}

function enclosingBranches(schemaPath, containers) {
  const parts = schemaPath.split('/');
  const found = [];
  let path = '';
  for (let index = 0; index + 1 < parts.length; index += 1) {
    path = index === 0 ? parts[0] : `${path}/${parts[index]}`;
    if (containers.has(path)) found.push({ container: path, branch: parts[index + 1] });
  }
  return found;
}

function outranks(candidate, incumbent) {
  if (candidate.disagrees !== incumbent.disagrees) return incumbent.disagrees;
  return candidate.reach > incumbent.reach;
}

function scoreBranches(errors, containers) {
  const scores = new Map();
  const memberships = [];
  for (const error of errors) {
    if (typeof error.schemaPath !== 'string') continue;
    for (const { container, branch } of enclosingBranches(error.schemaPath, containers)) {
      const byBranch = scores.get(container) ?? new Map();
      const prior = byBranch.get(branch) ?? { reach: 0, disagrees: false };
      byBranch.set(branch, {
        reach: Math.max(prior.reach, instanceDepth(error.instancePath)),
        disagrees: prior.disagrees || DISCRIMINATOR_KEYWORDS.includes(error.keyword),
      });
      scores.set(container, byBranch);
      memberships.push({ error, container, branch });
    }
  }
  return { scores, memberships };
}

function suppressedByBranch(errors) {
  const containers = containerPaths(errors);
  if (containers.size === 0) return new Set();
  const { scores, memberships } = scoreBranches(errors, containers);
  const best = new Map(
    [...scores].map(([container, byBranch]) => [
      container,
      [...byBranch.values()].reduce((winner, score) => (outranks(score, winner) ? score : winner)),
    ]),
  );
  return new Set(
    memberships
      .filter(({ container, branch }) => outranks(best.get(container), scores.get(container).get(branch)))
      .map(({ error }) => error),
  );
}

export function projectValidationErrors(errors, options = {}) {
  const { prefix = '', remedy = null } = options;
  const list = (Array.isArray(errors) ? errors : []).filter((error) => error);
  const dropped = suppressedByBranch(list);
  const projected = list
    .filter((error) => !WRAPPER_KEYWORDS.includes(error.keyword) && !dropped.has(error))
    .map((error) => projectOne(error, prefix))
    .map((problem) => (remedy === null ? problem : { ...problem, remedy }));
  return mergeTypeAlternatives(projected);
}
