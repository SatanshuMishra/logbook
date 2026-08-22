import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeStored, clipGraphemes } from '../../src/render/escape.ts'

test('escape.covers-both-classes', () => {
  const cases: Array<[string, string]> = [
    ['\u200B', 'U+200B'],
    ['\u200E', 'U+200E'],
    ['\u2028', 'U+2028'],
    ['\u2029', 'U+2029'],
    ['\r', 'U+000D'],
    ['\n', 'U+000A'],
    ['\t', 'U+0009'],
    ['\u0000', 'U+0000']
  ]
  const input = cases.map(([char]) => char).join('x')
  const escaped = escapeStored(input)
  for (const [char, hex] of cases) {
    assert.ok(escaped.includes(hex), `missing ${hex} for ${JSON.stringify(char)}`)
    assert.ok(!escaped.includes(char), `raw character survived for ${hex}`)
  }
})

test('escape.title-cannot-forge-heading', () => {
  const input = '# Injected\n## Also'
  const escaped = escapeStored(input)
  assert.equal(escaped, 'U+0023 InjectedU+000AU+0023# Also')
  assert.equal(escaped.split('\n').length, 1)
  assert.equal(escaped.startsWith('#'), false)
  assert.equal(/(^|\n)#{1,6}\s/.test(escaped), false)
})

test('clip.is-grapheme-safe', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'
  const input = family.repeat(5)
  const clipped = clipGraphemes(input, 3)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const graphemeCount = Array.from(segmenter.segment(clipped)).length
  assert.equal(graphemeCount, 3)
  assert.equal(clipped, family.repeat(3))
  const roundTripped = Buffer.from(clipped, 'utf8').toString('utf8')
  assert.equal(roundTripped, clipped)
})
