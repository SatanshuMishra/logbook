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
export const REMEDY_MAX_CHARS = 148;
const EXAMPLE_MAX_CHARS = 80;
export const FIELD_MAX_CHARS = 120;
const PROBLEM_FIELDS_SHOWN = 4;
const PROBLEMS_EMITTED_MAX = PROBLEM_FIELDS_SHOWN;
const BYTES_PER_CHAR_BUDGET = 2;
const ELLIPSIS = '...';

export const ECHO_MIN_CHARS = 24;

const QUOTE_CHARS = 2;
const PLAIN_SPACE = ' ';
const ESCAPE_RADIX = 16;
const ESCAPE_DIGITS = 4;
const NOTE_OPEN = `${ELLIPSIS} (`;
const NOTE_CLOSE = ' chars)';

const FOLDED_CLASS = '\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Zs}';
const BLANK_CLASS = '\\p{Default_Ignorable_Code_Point}\\u2800';
const INVISIBLE = new RegExp(`[${FOLDED_CLASS}\\s]+`, 'gu');
const FORMAT_RUN = new RegExp(`[${FOLDED_CLASS}${BLANK_CLASS}]+`, 'gu');
const ECHO_ATOM = /\\u[0-9a-fA-F]{4}|\\[\s\S]|[\s\S]/gu;
const TRAILING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;
const TRAILING_PARTIAL_ESCAPE = /(\\*)(u[0-9a-fA-F]{0,3})?$/;

export function collapse(value) {
  return String(value).replace(INVISIBLE, ' ').trim();
}

function escapeUnit(unit) {
  return `\\u${unit.charCodeAt(0).toString(ESCAPE_RADIX).padStart(ESCAPE_DIGITS, '0')}`;
}

function escapeFormatRun(run) {
  return run === PLAIN_SPACE ? run : run.split('').map(escapeUnit).join('');
}

export function escapeFormat(value) {
  return String(value).replace(FORMAT_RUN, escapeFormatRun);
}

function trimPartialEscape(text) {
  const match = TRAILING_PARTIAL_ESCAPE.exec(text);
  const slashes = match === null ? '' : match[1];
  if (slashes.length % 2 === 0) return text;
  const escapeTail = match[2] ?? '';
  return text.slice(0, text.length - 1 - escapeTail.length);
}

function slicePairedUnits(text, end) {
  if (text.length <= end) return text;
  const cut = text.slice(0, Math.max(0, end));
  return TRAILING_HIGH_SURROGATE.test(cut) ? cut.slice(0, -1) : cut;
}

function sliceWholeCharacters(text, end) {
  return trimPartialEscape(slicePairedUnits(text, Math.max(0, end)));
}

function takeAtoms(body, budget) {
  const atoms = body.match(ECHO_ATOM) ?? [];
  const taken = atoms.reduce(
    (acc, atom) => (acc.full || acc.used + atom.length > budget
      ? { ...acc, full: true }
      : { used: acc.used + atom.length, kept: acc.kept + 1, full: false }),
    { used: 0, kept: 0, full: false },
  );
  return atoms.slice(0, taken.kept).join('');
}

function describeValue(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return 'an object';
}

export function echo(value, max) {
  if (typeof value !== 'string') return describeValue(value);
  const bound = Number.isFinite(max) ? Math.max(max, ECHO_MIN_CHARS) : ECHO_MIN_CHARS;
  const head = slicePairedUnits(value, bound);
  const body = escapeFormat(JSON.stringify(head).slice(1, -1));
  if (head.length === value.length && body.length + QUOTE_CHARS <= bound) {
    return `"${body}"`;
  }
  const note = `${NOTE_OPEN}${value.length}${NOTE_CLOSE}`;
  const budget = Math.max(0, bound - QUOTE_CHARS - note.length);
  return `"${takeAtoms(body, budget)}"${note}`;
}

export function echoBetween(before, after, value, slot = REMEDY_MAX_CHARS) {
  return `${before}${echo(value, slot - before.length - after.length)}${after}`;
}

export function clip(value, max) {
  const text = collapse(value);
  if (text.length <= max) return text;
  return `${sliceWholeCharacters(text, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

function requireText(value, key) {
  const text = typeof value === 'string' ? collapse(value) : '';
  if (text.length === 0) {
    throw new TypeError(`LedgerError: ${key} must be a non-empty string`);
  }
  return text;
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

function halve(text) {
  return `${sliceWholeCharacters(text, Math.floor(text.length / 2) - ELLIPSIS.length)}${ELLIPSIS}`;
}

function fit(value, maxChars) {
  const text = clip(value, maxChars);
  const budget = maxChars * BYTES_PER_CHAR_BUDGET;
  if (encodedBytes(text) <= budget || text.length <= ELLIPSIS.length + 1) return text;
  return fit(halve(text), maxChars);
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

export function shedProblems(record) {
  const { problems, ...rest } = record;
  return { ...rest, shown: 0 };
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
    const emitted = this.problems.slice(0, PROBLEMS_EMITTED_MAX).map(emitProblem);
    const record = {
      error: this.name,
      message: this.message,
      layer: this.layer,
      ...emitProblem(this),
      problems: emitted,
      shown: emitted.length,
      total: this.problems.length,
    };
    return withinDetailBudget(record) ? record : shedProblems(record);
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
  const raw = error && typeof error.message === 'string' && error.message.trim().length > 0
    ? error.message
    : String(error);
  const detail = escapeFormat(raw);
  return new LedgerError({
    code: 'internal_error',
    layer: 'server',
    field: requireText(field, 'field'),
    expected: `a call the server can complete; it failed with: ${detail}`,
    retryable: false,
    remedy: 'the server could not classify this failure; read the reported cause before deciding whether to re-send',
  });
}
