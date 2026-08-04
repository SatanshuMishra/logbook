export const LEDGER_ERROR_LAYERS = Object.freeze([
  'input',
  'tool',
  'cap',
  'record',
  'server',
]);

export const MESSAGE_MAX_CHARS = 400;

const HEAD_MAX_CHARS = 180;
const REMEDY_MAX_CHARS = 148;
const EXAMPLE_MAX_CHARS = 80;
const PROBLEM_FIELDS_SHOWN = 4;
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

export function normalizeProblem(problem) {
  const source = problem ?? {};
  return Object.freeze({
    code: requireText(source.code, 'code'),
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
    return {
      error: this.name,
      message: this.message,
      code: this.code,
      layer: this.layer,
      field: this.field,
      expected: this.expected,
      example: this.example,
      retryable: this.retryable,
      remedy: this.remedy,
      problems: this.problems.map((problem) => ({ ...problem })),
    };
  }
}

export function isLedgerError(value) {
  return value instanceof LedgerError;
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
    remedy: 'this is a server-side fault, not a defect in the call; do not re-send the same call until it is resolved',
  });
}
