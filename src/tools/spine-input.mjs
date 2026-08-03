import { LEGACY_SCOPE } from '../schema/patterns.mjs';
import { resolveWriteScope } from '../model/index.mjs';
import { ToolError } from './shared.mjs';

const RISK_SENTENCE = /^[^\n]+ — [^\n]+$/;
const RISK_SHAPE = '"<specific constraint or action> — <why, in plain words>": two non-empty clauses on one line, joined by a spaced em dash';
const DEDUP_MIN_CHARS = 24;

export function assertWritableScope(scope, label) {
  if (scope === LEGACY_SCOPE) {
    throw new ToolError(
      `${label}: scope "${LEGACY_SCOPE}" is set only by the v1 upcast and is refused on every write path`,
    );
  }
  return scope;
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
