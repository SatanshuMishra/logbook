export const LEDGER_ERROR_LAYERS = Object.freeze([
  'input',
  'tool',
  'cap',
  'record',
  'server',
]);

export const LEDGER_ERROR_CODES = Object.freeze([
  'already_active',
  'blank_parameter',
  'cap_exceeded',
  'dod_unmet',
  'empty_criteria',
  'empty_options',
  'empty_scope_replacement',
  'illegal_transition',
  'internal_error',
  'invalid_const',
  'invalid_enum',
  'invalid_length',
  'invalid_pattern',
  'invalid_risk_text',
  'invalid_scope',
  'invalid_type',
  'invalid_value',
  'missing_parameter',
  'not_terminal',
  'open_detour',
  'record_invalid',
  'restated_decision',
  'struck_criterion',
  'terminal_thread',
  'underivable_slug',
  'unexpected_parameter',
  'unknown_criterion',
  'unknown_decision',
  'unknown_thread',
  'unknown_tool',
  'unreadable_decision',
]);

export const MESSAGE_MAX_CHARS = 400;

export const DETAIL_MAX_BYTES = 8192;

const HEAD_MAX_CHARS = 180;
const REMEDY_MAX_CHARS = 148;
const EXAMPLE_MAX_CHARS = 80;
const FIELD_MAX_CHARS = 120;
const PROBLEM_FIELDS_SHOWN = 4;
const PROBLEMS_EMITTED_MAX = PROBLEM_FIELDS_SHOWN;
const BYTES_PER_CHAR_BUDGET = 2;
const ELLIPSIS = '...';

export function collapse(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function clip(value, max) {
  const text = collapse(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - ELLIPSIS.length))}${ELLIPSIS}`;
}

function requireText(value, key) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`LedgerError: ${key} must be a non-empty string`);
  }
  return collapse(value);
}

function optionalText(value, key) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`LedgerError: ${key} must be a string when present`);
  }
  const text = collapse(value);
  return text.length === 0 ? null : text;
}

function requireLayer(value) {
  if (!LEDGER_ERROR_LAYERS.includes(value)) {
    throw new TypeError(
      `LedgerError: layer must be one of ${LEDGER_ERROR_LAYERS.join(', ')}`,
    );
  }
  return value;
}

function requireRetryable(value) {
  if (typeof value !== 'boolean') {
    throw new TypeError('LedgerError: retryable must be a boolean');
  }
  return value;
}

function requireCode(value) {
  const code = requireText(value, 'code');
  if (!LEDGER_ERROR_CODES.includes(code)) {
    throw new TypeError(
      `LedgerError: code ${code} is not a member of LEDGER_ERROR_CODES`,
    );
  }
  return code;
}

export function normalizeProblem(problem) {
  const source = problem ?? {};
  return Object.freeze({
    code: requireCode(source.code),
    field: requireText(source.field, 'field'),
    expected: requireText(source.expected, 'expected'),
    example: optionalText(source.example, 'example'),
    retryable: requireRetryable(source.retryable),
    remedy: requireText(source.remedy, 'remedy'),
  });
}

export function normalizeLedgerErrorDetail(detail) {
  const source = detail ?? {};
  const supplied = Array.isArray(source.problems) ? source.problems : [];
  const problems = supplied.length > 0
    ? supplied.map(normalizeProblem)
    : [normalizeProblem(source)];
  return Object.freeze({
    ...problems[0],
    layer: requireLayer(source.layer),
    problems: Object.freeze(problems),
  });
}

function problemsLine(problems) {
  if (problems.length < 2) return null;
  const shown = problems.slice(0, PROBLEM_FIELDS_SHOWN).map((p) => p.field);
  const hidden = problems.length - shown.length;
  const more = hidden > 0 ? `, +${hidden} more` : '';
  return `problems: ${problems.length} (${shown.join(', ')}${more})`;
}

function encodedBytes(text) {
  return Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;
}

function fit(value, maxChars) {
  const text = clip(value, maxChars);
  const budget = maxChars * BYTES_PER_CHAR_BUDGET;
  if (encodedBytes(text) <= budget || text.length <= ELLIPSIS.length + 1) return text;
  return fit(text.slice(0, Math.floor(text.length / 2)), maxChars);
}

function emitProblem(problem) {
  return {
    code: problem.code,
    field: fit(problem.field, FIELD_MAX_CHARS),
    expected: fit(problem.expected, HEAD_MAX_CHARS),
    example: problem.example === null || problem.example === undefined
      ? null
      : fit(problem.example, EXAMPLE_MAX_CHARS),
    retryable: problem.retryable,
    remedy: fit(problem.remedy, REMEDY_MAX_CHARS),
  };
}

export function renderLedgerError(detail) {
  const head = clip(`${detail.code}: ${detail.field}: ${detail.expected}`, HEAD_MAX_CHARS);
  const optional = [
    `retryable: ${detail.retryable}`,
    `remedy: ${clip(detail.remedy, REMEDY_MAX_CHARS)}`,
    detail.example ? `example: ${clip(detail.example, EXAMPLE_MAX_CHARS)}` : null,
    problemsLine(detail.problems ?? []),
  ].filter((line) => line !== null);
  const lines = [head];
  let used = head.length;
  for (const line of optional) {
    if (used + 1 + line.length > MESSAGE_MAX_CHARS) continue;
    lines.push(line);
    used += 1 + line.length;
  }
  return lines.join('\n');
}

function withinDetailBudget(record) {
  return Buffer.byteLength(JSON.stringify(record), 'utf8') <= DETAIL_MAX_BYTES;
}

function shedProblems(record, total) {
  const { problems, ...rest } = record;
  return problems === undefined ? rest : { ...rest, truncated: true, total };
}

export class LedgerError extends Error {
  constructor(detail) {
    const record = normalizeLedgerErrorDetail(detail);
    super(renderLedgerError(record));
    this.name = 'LedgerError';
    this.code = record.code;
    this.layer = record.layer;
    this.field = record.field;
    this.expected = record.expected;
    this.example = record.example;
    this.retryable = record.retryable;
    this.remedy = record.remedy;
    this.problems = record.problems;
  }

  toDetail() {
    const shown = this.problems.slice(0, PROBLEMS_EMITTED_MAX).map(emitProblem);
    const cut = this.problems.length - shown.length;
    const record = {
      error: this.name,
      message: this.message,
      layer: this.layer,
      ...emitProblem(this),
      ...(this.problems.length > 1 ? { problems: shown } : {}),
      ...(cut > 0 ? { truncated: true, total: this.problems.length } : {}),
    };
    return withinDetailBudget(record) ? record : shedProblems(record, this.problems.length);
  }
}

export function isLedgerError(value) {
  return value instanceof LedgerError;
}

export class ToolError extends LedgerError {
  constructor(detail) {
    super({ layer: 'tool', ...detail });
    this.name = 'ToolError';
  }
}

export function toLedgerError(error, field) {
  if (isLedgerError(error)) return error;
  const detail = error && typeof error.message === 'string' && error.message.trim().length > 0
    ? error.message
    : String(error);
  return new LedgerError({
    code: 'internal_error',
    layer: 'server',
    field: requireText(field, 'field'),
    expected: `a call the server can complete; it failed with: ${detail}`,
    retryable: false,
    remedy: 'the server could not classify this failure; read the reported cause before deciding whether to re-send',
  });
}
