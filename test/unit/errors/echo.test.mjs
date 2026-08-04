import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapse,
  echo,
  echoBetween,
  escapeFormat,
  ECHO_MIN_CHARS,
  REMEDY_MAX_CHARS,
} from '../../../src/errors.mjs';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ASTRAL = String.fromCodePoint(0x1f9f5);
const MIXED_NAME = `op${String.fromCodePoint(0x202e)}en_x`;
const ZERO_WIDTH = String.fromCodePoint(0x200b);
const INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
const WIDE = 96;

const FOLDED_POINTS = Object.freeze([
  0x0000, 0x0007, 0x001b, 0x007f, 0x0085, 0x00a0, 0x00ad,
  0x2000, 0x200b, 0x200e, 0x2028, 0x2029, 0x202e, 0x2066, 0x3000, 0xfeff,
]);

const BLANK_POINTS = Object.freeze([
  0x034f, 0x115f, 0x1160, 0x2800, 0x3164, 0xfe00, 0xfe0f, 0xffa0, 0xe0100, 0xe01ef,
]);

const SCRIPT_SAMPLES = Object.freeze([
  [0x0939, 0x093f, 0x0928, 0x094d, 0x0926, 0x0940],
  [0x0645, 0x064e, 0x0631, 0x0652, 0x062d, 0x064e, 0x0628],
  [0x0e44, 0x0e17, 0x0e22, 0x0e48],
  [0x00e9, 0x0065, 0x0301],
].map((points) => String.fromCodePoint(...points)));

function label(text) {
  return [...text]
    .map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

function quotedPart(rendered) {
  const match = /^"(?:[^"\\]|\\.)*"/.exec(rendered);
  return match === null ? null : match[0];
}

test('every character collapse would rewrite is escaped, across the whole basic plane', () => {
  const sampled = [
    ...Array.from({ length: 0x3200 }, (unused, point) => point),
    0xfe00, 0xfe0f, 0xfeff, 0xffa0, 0xfff9, 0x1d173, 0xe0001, 0xe0020, 0xe0100, 0xe01ef,
  ];

  for (const point of sampled) {
    const value = `a${String.fromCodePoint(point)}b`;
    const rendered = echo(value, WIDE);
    assert.equal(
      collapse(rendered),
      rendered,
      `collapse rewrote the echo of U+${point.toString(16)}: ${JSON.stringify(rendered)}`,
    );
  }
});

test('a blank that renders as nothing is escaped even though it is not a format control', () => {
  for (const point of BLANK_POINTS) {
    const name = `open${String.fromCodePoint(point)}_x`;
    const rendered = echo(name, WIDE);
    assert.doesNotMatch(
      rendered,
      INVISIBLE_CHARACTER,
      `U+${point.toString(16)} survived into the echo raw, so it still reads as a clean open_x`,
    );
    assert.match(rendered, /^"open(?:\\u[0-9a-f]{4})+_x"$/);
    assert.equal(JSON.parse(quotedPart(rendered)), name);
  }
});

test('every invisible name, folded or merely blank, gets its own identifiable rendering', () => {
  const points = [...FOLDED_POINTS, ...BLANK_POINTS];
  const rendered = points.map((point) => echo(String.fromCodePoint(point), WIDE));

  assert.equal(
    new Set(rendered).size,
    points.length,
    `renderings collided: ${JSON.stringify(rendered)}`,
  );
  assert.equal(echo(String.fromCodePoint(0xe0100), WIDE), '"\\udb40\\udd00"');
  assert.equal(echo(String.fromCodePoint(0xfe0f), WIDE), '"\\ufe0f"');
  assert.equal(echo(String.fromCodePoint(0x034f), WIDE), '"\\u034f"');
  assert.equal(echo(String.fromCodePoint(0x3164), WIDE), '"\\u3164"');
  assert.equal(echo(String.fromCodePoint(0x2800), WIDE), '"\\u2800"');
});

test('a real combining mark in an ordinary script is never escaped into noise', () => {
  for (const sample of SCRIPT_SAMPLES) {
    assert.equal(
      echo(sample, WIDE),
      `"${sample}"`,
      `${label(sample)} was escaped, which is the over-escaping regression`,
    );
  }
});

test('an ordinary spaced value keeps its plain spaces rather than being escaped', () => {
  assert.equal(echo('ship the thing', WIDE), '"ship the thing"');
  assert.equal(echo(ULID, WIDE), `"${ULID}"`);
  assert.equal(echo('completion_criteria', WIDE), '"completion_criteria"');
});

test('a run of more than one space is escaped, because collapse would otherwise fold it', () => {
  assert.equal(echo('a  b', WIDE), '"a\\u0020\\u0020b"');
  assert.equal(echo(' a', WIDE), '" a"');
  assert.equal(echo(String.fromCodePoint(0x0061, 0x00a0, 0x0062), WIDE), '"a\\u00a0b"');
  assert.notEqual(echo(' ', WIDE), echo('  ', WIDE));
});

test('a mixed visible and invisible name echoes so the exact key can be reconstructed', () => {
  assert.equal(echo(MIXED_NAME, WIDE), '"op\\u202een_x"');
  assert.notEqual(echo(MIXED_NAME, WIDE), '"op en_x"');
  assert.equal(JSON.parse(echo(MIXED_NAME, WIDE)), MIXED_NAME);
});

test('an echo is a valid JSON string literal that round-trips without doubling a backslash', () => {
  const values = [
    '', ' ', 'a b', 'a"b', 'a\\b', '\\u200b', ASTRAL, '\ud800', '"', '\t', '\r\n',
    MIXED_NAME, ULID, ...SCRIPT_SAMPLES,
    ...FOLDED_POINTS.map((point) => String.fromCodePoint(point)),
    ...BLANK_POINTS.map((point) => String.fromCodePoint(point)),
  ];

  for (const value of values) {
    const rendered = echo(value, WIDE);
    assert.equal(JSON.parse(rendered), value, `${label(value)} did not round-trip`);
  }
});

test('a non-string value is described by type, never rendered as a plausible string', () => {
  assert.equal(echo(['c1'], WIDE), 'an array of 1');
  assert.equal(echo([], WIDE), 'an array of 0');
  assert.equal(echo({ scope: 'c1' }, WIDE), 'an object');
  assert.equal(echo(5, WIDE), '5');
  assert.equal(echo(true, WIDE), 'true');
  assert.equal(echo(null, WIDE), 'null');
  assert.equal(echo(undefined, WIDE), 'absent');

  assert.notEqual(echo(['c1'], WIDE), '"c1"');
  assert.notEqual(echo(5, WIDE), '"5"');
});

test('a truncation marker sits outside the quotes, so caller data cannot forge it', () => {
  const cut = echo('a'.repeat(40), 24);
  const whole = echo('abcde', 24);

  assert.equal(cut.endsWith('"'), false, `a truncated echo must not end in a quote: ${cut}`);
  assert.match(cut, /"\.\.\. \(40 chars\)$/);
  assert.equal(whole, '"abcde"');
});

test('a caller-supplied ellipsis never collides with a server truncation', () => {
  assert.notEqual(echo('abcde...', 8), echo('abcdefghij', 8));
  assert.notEqual(echo(`${'a'.repeat(21)}...`, 24), echo('a'.repeat(40), 24));
  assert.equal(echo('abcde... (40 chars)', 32), '"abcde... (40 chars)"');
});

test('two values of different true length never render identically', () => {
  const rendered = [30, 40, 50, 120].map((length) => echo('a'.repeat(length), 24));
  assert.equal(new Set(rendered).size, rendered.length, JSON.stringify(rendered));
});

test('truncation never splits an escape token or a surrogate pair', () => {
  for (const value of [ZERO_WIDTH.repeat(40), ASTRAL.repeat(40), `${MIXED_NAME}${ASTRAL}`.repeat(20)]) {
    const rendered = echo(value, 32);
    assert.doesNotMatch(rendered, LONE_SURROGATE, `${label(value.slice(0, 4))} left a lone surrogate`);
    assert.equal(typeof JSON.parse(quotedPart(rendered)), 'string');
    assert.equal(collapse(rendered), rendered);
  }
});

test('an echo never exceeds the bound its consumer gave it', () => {
  const values = ['a'.repeat(400), ZERO_WIDTH.repeat(400), ASTRAL.repeat(400), MIXED_NAME.repeat(40)];
  for (const max of [ECHO_MIN_CHARS, 32, 48, 64, 96, 128]) {
    for (const value of values) {
      const rendered = echo(value, max);
      assert.ok(
        rendered.length <= max,
        `echo(${label(value.slice(0, 2))}, ${max}) returned ${rendered.length} chars: ${rendered}`,
      );
    }
  }
});

test('a bound below the floor is raised to the floor rather than silently overrun', () => {
  for (const max of [-10, 0, 1, 5, undefined, Number.NaN, null]) {
    const rendered = echo('abcdefghij', max);
    assert.ok(
      rendered.length <= ECHO_MIN_CHARS,
      `echo with max ${max} returned ${rendered.length} chars: ${rendered}`,
    );
  }
});

test('echoBetween sizes the echo against the slot its prose must share', () => {
  const before = 'no thread is stored under ';
  const after = '; thread ids are server-assigned, so re-send with an id this ledger returned';

  const hostile = echoBetween(before, after, 'z'.repeat(400));
  assert.ok(
    hostile.length <= REMEDY_MAX_CHARS,
    `composed remedy ran to ${hostile.length} chars: ${hostile}`,
  );
  assert.ok(hostile.endsWith(after), 'the server instruction was pushed out of its own remedy');
  assert.equal(echoBetween(before, after, ULID), `${before}"${ULID}"${after}`);
});

test('escapeFormat hides no invisible character and adds no quotes', () => {
  assert.equal(escapeFormat(`driver failed on ${MIXED_NAME}`), 'driver failed on op\\u202een_x');
  assert.equal(escapeFormat('an ordinary message'), 'an ordinary message');
  assert.equal(collapse(escapeFormat(`a${String.fromCodePoint(0x0085)}b`)), 'a\\u0085b');
});

test('a pathological value is bounded before the regex work, not after', () => {
  const huge = 'a'.repeat(4_000_000);
  const started = process.hrtime.bigint();
  const rendered = echo(huge, 32);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.match(rendered, /^"a+"\.\.\. \(4000000 chars\)$/);
  assert.ok(rendered.length <= 32);
  assert.ok(elapsedMs < 200, `echo took ${elapsedMs}ms on a 4M-char value, so it is still O(N)`);
});
