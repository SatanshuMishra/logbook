import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES, clipWithMarker } from '../../src/render/clip.ts'
import { escapeStored } from '../../src/render/escape.ts'

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

const LONG_ASCII = 'x'.repeat(200)
const LONG_CJK = '漢'.repeat(200)
const FAMILY_EMOJI = '\u{1F468}‍\u{1F469}‍\u{1F467}'
const LONG_MULTI_UNIT_GRAPHEMES = FAMILY_EMOJI.repeat(20)
const PREFIX_LENGTH = 50
const ESCAPE_TOKEN_GRAPHEMES = 6
const ESCAPED_NEWLINE_TOKEN_TEXT = `${'a'.repeat(PREFIX_LENGTH)}U+000A${'b'.repeat(PREFIX_LENGTH)}`

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
            contentCount <= PREFIX_LENGTH || contentCount >= PREFIX_LENGTH + ESCAPE_TOKEN_GRAPHEMES,
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

const STRUCTURAL_MARKER_AT_LINE_START = /^[ \t]*(#{1,6}|_{3,}|[-*+>]|`{3}|~{3}|\d+[.)])(?=\s|$)/

const graphemesOf = (text: string): string[] =>
  Array.from(GRAPHEME_SEGMENTER.segment(text), (entry) => entry.segment)

const markerFormsThatCanFillAWholeRenderedLine = (marker: string): string[] => {
  const graphemes = graphemesOf(marker)
  return graphemes.map((_grapheme, index) => graphemes.slice(0, index + 1).join(''))
}

const forgedLineStartFailure = (form: string): string =>
  `the clip marker renders as the whole line ${JSON.stringify(`> ${form}`)}, which opens with a markdown block marker. escapeStoredBlock clips the escaped text before it prefixes every line with the blockquote marker, so a clip point landing on a line boundary leaves the marker, or the leading part of it that fits the budget, as the entire content of a rendered briefing line. The server writes that line itself, so escapeStored never sees it and nothing neutralises it: a marker reading as a heading, a bullet, a blockquote, a fence, a thematic break or an ordered list item forges from the renderer exactly the structure the escaper exists to stop a stored value forging. Choose a CLIP_MARKER in src/render/clip.ts whose every leading run of graphemes begins no markdown block.`

test('clip.no-rendered-form-of-the-marker-opens-a-line-with-a-markdown-block-marker', () => {
  const forms = markerFormsThatCanFillAWholeRenderedLine(CLIP_MARKER)
  assert.equal(
    forms.length,
    CLIP_MARKER_GRAPHEMES,
    'the marker yielded fewer forms than it has graphemes, so this check measures fewer whole-line renders than clipWithMarker can emit'
  )
  for (const form of forms) {
    assert.equal(STRUCTURAL_MARKER_AT_LINE_START.test(form), false, forgedLineStartFailure(form))
  }
})

const LEADING_ESCAPE_TOKEN_TEXT = escapeStored(`\n${'z'.repeat(60)}`)

test('clip.a-value-opening-with-an-escape-token-keeps-its-own-content-in-the-zero-content-band', () => {
  for (let max = CLIP_MARKER_GRAPHEMES + 1; max <= CLIP_MARKER_GRAPHEMES + 5; max += 1) {
    const clipped = clipWithMarker(LEADING_ESCAPE_TOKEN_TEXT, max)
    assert.ok(clipped.endsWith(CLIP_MARKER), `clipping to ${max} graphemes must still end with the marker, got ${clipped}`)
    const withoutMarker = clipped.slice(0, clipped.length - CLIP_MARKER.length)
    assert.ok(
      graphemeCount(withoutMarker) >= 1,
      `clipping a value that opens with an escape token to ${max} graphemes must keep at least one grapheme of its own content, got ${JSON.stringify(clipped)}`
    )
  }
})
