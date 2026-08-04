import { LEGACY_SCOPE, WRITABLE_SCOPE_PATTERN } from '../schema/patterns.mjs';
import { resolveWriteScope } from '../model/index.mjs';
import { ToolError } from './shared.mjs';

const RISK_SENTENCE = /^[^\n]+ — [^\n]+$/;
const RISK_EXAMPLE = 'hold the ledger lock — the writer is not reentrant';
const RISK_SHAPE = 'two non-empty clauses on one line, joined by a spaced em dash';
const DEDUP_MIN_CHARS = 24;
const ECHO_MAX_CHARS = 48;
const WRITABLE_SCOPE = new RegExp(WRITABLE_SCOPE_PATTERN);

export const SCOPED_SPINE_FIELDS = Object.freeze(['open_risks', 'key_decisions']);

export function assertWritableScope(scope, field) {
  if (scope === LEGACY_SCOPE) {
    throw new ToolError({
      code: 'invalid_scope',
      field: `${field}.scope`,
      expected: 'a criterion id such as c1, or "thread"',
      example: 'c1',
      retryable: false,
      remedy: `scope "${LEGACY_SCOPE}" is set only by the v1 upcast and is refused on every write path; re-send with a criterion id or "thread"`,
    });
  }
  return scope;
}

function normalizeScopeList(scopes, field) {
  if (scopes === undefined || scopes === null) return [];
  if (!Array.isArray(scopes)) {
    throw new ToolError({
      code: 'invalid_type',
      field,
      expected: 'type array',
      retryable: false,
      remedy: `${field} must be an array of scopes; re-send it as one`,
    });
  }
  return scopes.map((scope) => {
    assertWritableScope(scope, field);
    if (typeof scope !== 'string' || !WRITABLE_SCOPE.test(scope)) {
      throw new ToolError({
        code: 'invalid_scope',
        field,
        expected: 'a criterion id such as c1, or "thread"',
        example: 'c1',
        retryable: false,
        remedy: `scope ${JSON.stringify(scope)} is neither a criterion id nor "thread"; re-send with an accepted scope`,
      });
    }
    return scope;
  });
}

export function normalizeReplaceScopes(value, tool) {
  if (value === undefined || value === null) {
    return Object.fromEntries(SCOPED_SPINE_FIELDS.map((field) => [field, []]));
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError({
      code: 'invalid_type',
      field: `${tool}.replace_scopes`,
      expected: `an object keyed by ${SCOPED_SPINE_FIELDS.join(' and ')}`,
      retryable: false,
      remedy: 'replace_scopes is an object of scope lists, not a flat list; re-send it in that shape',
    });
  }
  const unknown = Object.keys(value).filter((key) => !SCOPED_SPINE_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ToolError({
      code: 'unexpected_parameter',
      field: `${tool}.replace_scopes.${unknown[0]}`,
      expected: `only the keys ${SCOPED_SPINE_FIELDS.join(' and ')}`,
      retryable: false,
      remedy: `replace_scopes does not accept ${unknown.join(', ')}; remove those keys and re-send`,
    });
  }
  return Object.fromEntries(SCOPED_SPINE_FIELDS.map((field) => [
    field,
    normalizeScopeList(value[field], `${tool}.replace_scopes.${field}`),
  ]));
}

export function normalizeRisks(risks, thread, field) {
  return risks.map((risk) => {
    if (!RISK_SENTENCE.test(risk.text)) {
      throw new ToolError({
        code: 'invalid_risk_text',
        field: `${field}[].text`,
        expected: RISK_SHAPE,
        example: RISK_EXAMPLE,
        retryable: false,
        remedy: `risk text ${JSON.stringify(clipEntry(risk.text))} is not <specific constraint or action> — <why, in plain words>; re-send it in that shape`,
      });
    }
    const scope = assertWritableScope(risk.scope ?? resolveWriteScope(thread), field);
    return {
      text: risk.text,
      scope,
      refs: Array.isArray(risk.refs) ? [...risk.refs] : [],
    };
  });
}

export function normalizeDecisions(decisions, thread, knownRefs, field) {
  return decisions.map((decision) => {
    if (!knownRefs.has(decision.ref)) {
      throw new ToolError({
        code: 'unknown_decision',
        field: `${field}[].ref`,
        expected: 'a ref naming a decision file this ledger holds',
        example: '0007-adopt-the-ledger',
        retryable: false,
        remedy: `no decision file matches "${decision.ref}"; call record_decision first, then re-send with the ref it returns`,
      });
    }
    const scope = assertWritableScope(decision.scope ?? resolveWriteScope(thread), field);
    return { ref: decision.ref, title: decision.title, scope };
  });
}

function clipEntry(value) {
  const text = String(value);
  return text.length <= ECHO_MAX_CHARS ? text : `${text.slice(0, ECHO_MAX_CHARS - 3)}...`;
}

function normalizeForDedup(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function restates(a, b) {
  if (Math.min(a.length, b.length) < DEDUP_MIN_CHARS) return false;
  return a.includes(b) || b.includes(a);
}

export function assertNoRestatedDecision(entries, decisions, field) {
  const titles = decisions
    .filter((d) => d && typeof d.title === 'string')
    .map((d) => ({ title: d.title, normalized: normalizeForDedup(d.title) }));
  for (const entry of entries) {
    const normalized = normalizeForDedup(entry);
    for (const candidate of titles) {
      if (restates(normalized, candidate.normalized)) {
        throw new ToolError({
          code: 'restated_decision',
          field: `${field}[]`,
          expected: 'an entry that does not restate a recorded decision title',
          retryable: false,
          remedy: `${JSON.stringify(clipEntry(entry))} restates the decision ${JSON.stringify(clipEntry(candidate.title))}; the decision record is its single home, so drop the entry`,
        });
      }
    }
  }
}
