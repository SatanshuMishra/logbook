import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES, clipWithMarker } from '../../src/render/clip.ts'

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

const LONG_ASCII = 'x'.repeat(200)
const LONG_CJK = '漢'.repeat(200)
const FAMILY_EMOJI = '\u{1F468}‍\u{1F469}‍\u{1F467}'
const LONG_MULTI_UNIT_GRAPHEMES = FAMILY_EMOJI.repeat(20)
const ESCAPED_NEWLINE_TOKEN_TEXT = `${'a'.repeat(50)}U+000A${'b'.repeat(50)}`

const LIMIT_SWEEP_CEILING = 90

test('clip.a-value-that-fits-its-limit-is-returned-unchanged-and-unmarked', () => {
  for (const text of ['', 'short', LONG_ASCII]) {
    assert.equal(clipWithMarker(text, graphemeCount(text)), text)
    assert.equal(clipWithMarker(text, graphemeCount(text) + 1), text)
  }
})

test('clip.an-infinite-limit-never-shortens-and-never-marks', () => {
  for (const text of [LONG_ASCII, LONG_CJK, LONG_MULTI_UNIT_GRAPHEMES]) {
    assert.equal(clipWithMarker(text, Number.POSITIVE_INFINITY), text)
  }
})

test('clip.a-shortened-value-never-exceeds-its-own-limit-and-carries-the-marker-inside-it', () => {
  for (const text of [LONG_ASCII, LONG_CJK, LONG_MULTI_UNIT_GRAPHEMES, ESCAPED_NEWLINE_TOKEN_TEXT]) {
    for (let max = 0; max <= LIMIT_SWEEP_CEILING; max += 1) {
      const clipped = clipWithMarker(text, max)
      assert.ok(
        graphemeCount(clipped) <= max,
        `a value clipped to ${max} graphemes must not exceed that limit, got ${graphemeCount(clipped)}`
      )
      const wasShortened = graphemeCount(text) > max
      if (wasShortened && max >= CLIP_MARKER_GRAPHEMES) {
        assert.ok(clipped.endsWith(CLIP_MARKER), `a value clipped to ${max} graphemes must end with the marker, got ${clipped}`)
        const withoutMarker = clipped.slice(0, clipped.length - CLIP_MARKER.length)
        assert.ok(
          text.startsWith(withoutMarker),
          `a shortened value must be the input's own prefix followed by the marker and nothing else, got: ${clipped}`
        )
        if (text === ESCAPED_NEWLINE_TOKEN_TEXT) {
          const contentCount = graphemeCount(withoutMarker)
          assert.ok(
            contentCount <= 50 || contentCount >= 56,
            `clipping to ${max} graphemes must not cut inside the emitted U+000A escape token, got ${contentCount} graphemes of content`
          )
        }
      }
      if (!wasShortened) {
        assert.equal(clipped, text, `a value that fits ${max} graphemes must be returned unchanged`)
      }
    }
  }
})

test('clip.a-limit-smaller-than-the-marker-yields-only-as-much-of-the-marker-as-fits', () => {
  for (let max = 0; max < CLIP_MARKER_GRAPHEMES; max += 1) {
    const clipped = clipWithMarker(LONG_ASCII, max)
    assert.equal(clipped, CLIP_MARKER.slice(0, max), `at a limit of ${max} the value must be the marker truncated to fit`)
  }
})

test('clip.the-marker-is-one-grapheme-per-code-unit', () => {
  assert.equal(CLIP_MARKER, '...[shortened]')
  assert.equal(CLIP_MARKER_GRAPHEMES, CLIP_MARKER.length)
})
