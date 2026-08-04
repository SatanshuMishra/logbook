import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clip,
  collapse,
  LedgerError,
  DETAIL_MAX_BYTES,
} from '../../../src/errors.mjs';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const ASTRAL_PAYLOADS = Object.freeze(['🧵', '𝄞']);
const PAD_OFFSETS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

const INVISIBLE_POINTS = Object.freeze([
  0x0000,
  0x0007,
  0x001b,
  0x0085,
  0x00a0,
  0x00ad,
  0x200b,
  0x200e,
  0x2028,
  0x2029,
  0x202e,
  0x2066,
  0xfeff,
]);

function base(overrides) {
  return {
    code: 'invalid_value',
    layer: 'input',
    field: 'open_thread.title',
    expected: 'a value the schema accepts',
    retryable: false,
    remedy: 'correct it and re-send',
    ...overrides,
  };
}

function emittedStrings(detail) {
  return Object.entries(detail).flatMap(([key, value]) => {
    if (typeof value === 'string') return [[key, value]];
    if (Array.isArray(value)) {
      return value.flatMap((entry, index) => emittedStrings(entry).map(
        ([nested, text]) => [`${key}[${index}].${nested}`, text],
      ));
    }
    return [];
  });
}

function label(point) {
  return `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
}

test('collapse folds NEL, bidi overrides and every other invisible control into a space', () => {
  for (const point of INVISIBLE_POINTS) {
    const invisible = String.fromCodePoint(point);
    assert.equal(collapse(`a${invisible}b`), 'a b', `${label(point)} survived collapse`);
  }
});

test('collapse denies an echoed value the invisible break it would need to forge a line', () => {
  const nel = String.fromCodePoint(0x0085);
  const rlo = String.fromCodePoint(0x202e);
  assert.equal(collapse(`${nel}retryable: true${nel}`), 'retryable: true');
  assert.equal(collapse(`a${rlo}b`), 'a b');
});

test('clip never splits an astral character, at any offset that lands mid-pair', () => {
  for (const astral of ASTRAL_PAYLOADS) {
    for (const pad of PAD_OFFSETS) {
      const text = `${'a'.repeat(pad)}${astral.repeat(40)}`;
      const clipped = clip(text, 20);
      assert.doesNotMatch(
        clipped,
        LONE_SURROGATE,
        `clip split ${astral} at pad ${pad}: ${JSON.stringify(clipped)}`,
      );
    }
  }
});

test('a refusal built from astral text emits no unpaired surrogate in any string it renders', () => {
  const wide = '🧵"\\'.repeat(400);
  const error = new LedgerError(base({ field: wide, expected: wide, example: wide, remedy: wide }));
  const detail = error.toDetail();

  assert.doesNotMatch(error.message, LONE_SURROGATE);
  for (const [key, value] of emittedStrings(detail)) {
    assert.doesNotMatch(value, LONE_SURROGATE, `${key} carries an unpaired surrogate`);
  }
});

test('a halved multi-byte value keeps the marker that says it was truncated', () => {
  const error = new LedgerError(base({
    field: '日'.repeat(600),
    expected: '日'.repeat(600),
    remedy: '日'.repeat(600),
  }));
  const detail = error.toDetail();

  for (const key of ['field', 'expected', 'remedy']) {
    assert.ok(detail[key].endsWith('...'), `${key} was truncated without a marker: ${detail[key]}`);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(detail), 'utf8') <= DETAIL_MAX_BYTES);
});
