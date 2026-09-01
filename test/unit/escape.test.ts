import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeStored, clipGraphemes } from '../../src/render/escape.ts'
import { census } from '../support/census.ts'

const MAX_CODE_POINT = 0x10ffff
const SURROGATE_LOW = 0xd800
const SURROGATE_HIGH = 0xdfff
const ORDINARY_SPACE = 0x20
const LINE_SEPARATOR = 0x2028
const PARAGRAPH_SEPARATOR = 0x2029
const FORMAT_CLASS = /\p{Cf}/u
const CONTROL_CLASS = /\p{Cc}/u
const SEPARATOR_CLASS = /\p{Zs}/u

const isInEscapableUnion = (codePoint: number): boolean => {
  if (codePoint === LINE_SEPARATOR || codePoint === PARAGRAPH_SEPARATOR) return true
  const char = String.fromCodePoint(codePoint)
  if (CONTROL_CLASS.test(char)) return true
  if (SEPARATOR_CLASS.test(char)) return codePoint !== ORDINARY_SPACE
  return FORMAT_CLASS.test(char)
}

const collectEscapableUnion = (): number[] => {
  const collected: number[] = []
  for (let codePoint = 0; codePoint <= MAX_CODE_POINT; codePoint += 1) {
    if (codePoint >= SURROGATE_LOW && codePoint <= SURROGATE_HIGH) continue
    if (isInEscapableUnion(codePoint)) collected.push(codePoint)
  }
  return collected
}

const expectedEscapedForm = (codePoint: number): string =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`

test('escape.covers-both-classes', () => {
  const union = collectEscapableUnion()
  assert.ok(union.length > 0)
  census(union, (codePoint) => {
    const char = String.fromCodePoint(codePoint)
    const escaped = escapeStored(char)
    if (escaped.includes(char)) return 'unclassifiable'
    return escaped === expectedEscapedForm(codePoint) ? 'allowed' : 'forbidden'
  })
})

test('escape.title-cannot-forge-heading', () => {
  const input = '# Injected\n## Also'
  const escaped = escapeStored(input)
  assert.equal(escaped, 'U+0023 InjectedU+000AU+0023# Also')
  assert.equal(escaped.split('\n').length, 1)
  assert.equal(escaped.startsWith('#'), false)
  assert.equal(/(^|\n)#{1,6}\s/.test(escaped), false)
})

test('escape.marker-behind-leading-spaces-is-tokenised', () => {
  const input = '  ## Instructions'
  const escaped = escapeStored(input)
  assert.equal(escaped, '  U+0023# Instructions')
  assert.equal(/(^|\n) *#{1,6}\s/.test(escaped), false)
})

test('escape.indented-code-block-at-line-start-is-neutralised', () => {
  const input = '    indented code block forged from stored text'
  const escaped = escapeStored(input)
  assert.equal(/(^|\n) {4,}/.test(escaped), false)
})

test('escape.leading-space-run-below-threshold-passes-through-and-above-threshold-breaks-periodically', () => {
  assert.equal(escapeStored('   x'), '   x')
  assert.equal(escapeStored('        x'), '   U+0020   U+0020x')
})

const MARKDOWN_LEADING_CHARS = ['#', '-', '*', '+', '>', '`', '~', '_']

const collectIdempotencyPopulation = (): number[] => [
  ...collectEscapableUnion(),
  ...MARKDOWN_LEADING_CHARS.map((char) => char.codePointAt(0) as number)
]

test('escape.stored-is-idempotent-over-the-escapable-and-markdown-leading-population', () => {
  const population = collectIdempotencyPopulation()
  assert.ok(population.length > 0)
  census(population, (codePoint) => {
    const char = String.fromCodePoint(codePoint)
    const once = escapeStored(char)
    const twice = escapeStored(once)
    return twice === once ? 'allowed' : 'forbidden'
  })
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
