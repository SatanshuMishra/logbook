import { LEGACY_SCOPE, WRITABLE_SCOPE_PATTERN } from '../schema/patterns.mjs';
import { resolveWriteScope } from '../model/index.mjs';
import { ToolError } from './shared.mjs';

const RISK_SENTENCE = /^[^\n]+ — [^\n]+$/;
const RISK_SHAPE = '"<specific constraint or action> — <why, in plain words>": two non-empty clauses on one line, joined by a spaced em dash';
const DEDUP_MIN_CHARS = 24;
const WRITABLE_SCOPE = new RegExp(WRITABLE_SCOPE_PATTERN);

export const SCOPED_SPINE_FIELDS = Object.freeze(['open_risks', 'key_decisions']);

export function assertWritableScope(scope, label) {
  if (scope === LEGACY_SCOPE) {
    throw new ToolError(
      `${label}: scope "${LEGACY_SCOPE}" is set only by the v1 upcast and is refused on every write path`,
    );
  }
  return scope;
}

function normalizeScopeList(scopes, label) {
  if (scopes === undefined || scopes === null) return [];
  if (!Array.isArray(scopes)) {
    throw new ToolError(`${label}: expected an array of scopes`);
  }
  return scopes.map((scope) => {
    assertWritableScope(scope, label);
    if (typeof scope !== 'string' || !WRITABLE_SCOPE.test(scope)) {
      throw new ToolError(
        `${label}: scope ${JSON.stringify(scope)} is neither a criterion id nor "thread"`,
      );
    }
    return scope;
  });
}

export function normalizeReplaceScopes(value, label) {
  if (value === undefined || value === null) {
    return Object.fromEntries(SCOPED_SPINE_FIELDS.map((field) => [field, []]));
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError(
      `${label}: replace_scopes must be an object keyed by ${SCOPED_SPINE_FIELDS.join(' and ')}`,
    );
  }
  const unknown = Object.keys(value).filter((key) => !SCOPED_SPINE_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new ToolError(
      `${label}: replace_scopes does not accept ${unknown.join(', ')}; it names only ${SCOPED_SPINE_FIELDS.join(' and ')} scopes`,
    );
  }
  return Object.fromEntries(SCOPED_SPINE_FIELDS.map((field) => [
    field,
    normalizeScopeList(value[field], `${label}: replace_scopes.${field}`),
  ]));
}

export function normalizeRisks(risks, thread, label) {
  return risks.map((risk) => {
    if (!RISK_SENTENCE.test(risk.text)) {
      throw new ToolError(
        `${label}: risk text ${JSON.stringify(risk.text)} does not match the required shape ${RISK_SHAPE}`,
      );
    }
    const scope = assertWritableScope(risk.scope ?? resolveWriteScope(thread), label);
    return {
      text: risk.text,
      scope,
      refs: Array.isArray(risk.refs) ? [...risk.refs] : [],
    };
  });
}

export function normalizeDecisions(decisions, thread, knownRefs, label) {
  return decisions.map((decision) => {
    if (!knownRefs.has(decision.ref)) {
      throw new ToolError(
        `${label}: ref "${decision.ref}" does not match an existing decision file`,
      );
    }
    const scope = assertWritableScope(decision.scope ?? resolveWriteScope(thread), label);
    return { ref: decision.ref, title: decision.title, scope };
  });
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

export function assertNoRestatedDecision(entries, decisions, label) {
  const titles = decisions
    .filter((d) => d && typeof d.title === 'string')
    .map((d) => ({ title: d.title, normalized: normalizeForDedup(d.title) }));
  for (const entry of entries) {
    const normalized = normalizeForDedup(entry);
    for (const candidate of titles) {
      if (restates(normalized, candidate.normalized)) {
        throw new ToolError(
          `${label}: entry ${JSON.stringify(entry)} restates the decision title ${JSON.stringify(candidate.title)}; the decision record is its single home`,
        );
      }
    }
  }
}
