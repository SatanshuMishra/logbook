import test from 'node:test';
import assert from 'node:assert/strict';
import { collapse, echo, ECHO_MAX_CHARS } from '../../../src/errors.mjs';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ASTRAL = '\u{1F9F5}';
const MIXED_NAME = 'op\u202een_x';

const FORMAT_POINTS = Object.freeze([
  0x0000, 0x0007, 0x001b, 0x007f, 0x0085, 0x00a0, 0x00ad,
  0x2000, 0x200b, 0x200e, 0x2028, 0x2029, 0x202e, 0x2066, 0x3000, 0xfeff,
]);

const FORMAT_CORPUS = Object.freeze([
  ...FORMAT_POINTS.map((point) => String.fromCodePoint(point)),
  ...FORMAT_POINTS.map((point) => `a${String.fromCodePoint(point)}b`),
  '',
  ' ',
  'a b',
  'a  b',
  '  a  ',
  '\t',
  '\n',
  '\r\n',
  MIXED_NAME,
  ULID,
]);

function label(text) {
  return [...text]
    .map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

test('every echo survives collapse unchanged, so no quoted value can be silently rewritten', () => {
  for (const value of FORMAT_CORPUS) {
    const rendered = echo(value);
    assert.equal(
      collapse(rendered),
      rendered,
      `collapse rewrote the echo of ${label(value)}: ${JSON.stringify(rendered)}`,
    );
  }
});

test('distinct invisible characters never echo to the same rendering', () => {
  const points = [0x0000, 0x0085, 0x00a0, 0x00ad, 0x200b, 0x2028, 0x2029, 0x202e, 0xfeff];
  const rendered = points.map((point) => echo(String.fromCodePoint(point)));

  assert.equal(
    new Set(rendered).size,
    points.length,
    `echo conflated invisible characters: ${JSON.stringify(rendered)}`,
  );
  assert.deepEqual(rendered, [
    '"\\u0000"',
    '"\\u0085"',
    '"\\u00a0"',
    '"\\u00ad"',
    '"\\u200b"',
    '"\\u2028"',
    '"\\u2029"',
    '"\\u202e"',
    '"\\ufeff"',
  ]);
});

test('an ordinary spaced value keeps its plain spaces rather than being escaped', () => {
  assert.equal(echo('ship the thing'), '"ship the thing"');
  assert.equal(echo('a b'), '"a b"');
  assert.equal(echo(ULID), `"${ULID}"`);
});

test('a run of more than one space is escaped, because collapse would otherwise fold it', () => {
  assert.equal(echo('a  b'), '"a\\u0020\\u0020b"');
  assert.equal(echo(' a'), '" a"');
  assert.equal(echo(' '), '" "');
  assert.notEqual(echo(' '), echo(''));
  assert.notEqual(echo(' '), echo('  '));
  assert.equal(echo('a\u00a0b'), '"a\\u00a0b"');
});

test('a mixed visible and invisible name echoes so the exact key can be reconstructed', () => {
  assert.equal(echo(MIXED_NAME), '"op\\u202een_x"');
  assert.notEqual(echo(MIXED_NAME), '"op en_x"');
  assert.equal(JSON.parse(echo(MIXED_NAME)), MIXED_NAME);
});

test('an echo is a valid JSON string literal that round-trips without doubling a backslash', () => {
  const values = [...FORMAT_CORPUS, 'a"b', 'a\\b', '\\u200b', ASTRAL, '\ud800', '"'];
  for (const value of values) {
    const rendered = echo(value);
    assert.equal(typeof JSON.parse(rendered), 'string', `${label(value)} did not parse as a JSON string`);
    assert.equal(JSON.parse(rendered), value, `${label(value)} did not round-trip`);
  }
});

test('a literal backslash-u sequence stays distinct from the character it names', () => {
  assert.notEqual(echo('\\u200b'), echo('\u200b'));
  assert.equal(echo('\\u200b'), '"\\\\u200b"');
});

test('truncation marks itself and never splits an escape token or a surrogate pair', () => {
  const cases = [
    ['a'.repeat(30), 24, `"${'a'.repeat(21)}..."`],
    ['\u200b'.repeat(10), 24, '"\\u200b\\u200b\\u200b..."'],
    [ASTRAL.repeat(20), 24, `"${ASTRAL.repeat(10)}..."`],
  ];

  for (const [value, max, expected] of cases) {
    const rendered = echo(value, max);
    assert.equal(rendered, expected, `echo(${label(value)}, ${max}) rendered ${JSON.stringify(rendered)}`);
    assert.equal(typeof JSON.parse(rendered), 'string');
    assert.doesNotMatch(JSON.parse(rendered), LONE_SURROGATE);
    assert.equal(collapse(rendered), rendered);
  }
});

test('the default bound leaves a server-assigned id and a realistic key echoed in full', () => {
  assert.ok(ECHO_MAX_CHARS >= ULID.length, `the default bound ${ECHO_MAX_CHARS} truncates a ULID`);
  assert.equal(echo(ULID).includes('...'), false);
  assert.equal(echo('completion_criteria'), '"completion_criteria"');
});

test('a non-string value is echoed through its string form rather than crashing', () => {
  assert.equal(echo(9999), '"9999"');
  assert.equal(echo(null), '"null"');
  assert.equal(echo(undefined), '"undefined"');
});
