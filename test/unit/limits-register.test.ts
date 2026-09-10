import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLimitsRegister, parseLimitsRegisterRows } from '../support/limits-register.ts'

const SYNTHETIC_LABEL = 'synthetic'

const validRow = (overrides: Record<string, unknown> = {}): unknown => ({
  name: 'SOME_MAX',
  site: 'src/example.ts:1',
  value: 10,
  basis: 'unrecorded',
  reason: null,
  mirrors: null,
  mirror_relation: null,
  ...overrides
})

test('limits-register.loads-the-committed-register', () => {
  const rows = loadLimitsRegister()
  assert.ok(rows.length > 0, 'limits-register: the committed register loaded zero rows')
})

test('limits-register.every-committed-row-has-a-unique-path-and-name-key', () => {
  const rows = loadLimitsRegister()
  const keys = new Set<string>()
  for (const row of rows) {
    const path = row.site.slice(0, row.site.lastIndexOf(':'))
    const key = `${path}::${row.name}`
    assert.ok(!keys.has(key), `limits-register: ${key} appears more than once in the committed register`)
    keys.add(key)
  }
})

test('limits-register.refuses-a-non-unrecorded-row-with-a-null-reason', () => {
  const rows = [validRow({ basis: 'chosen', reason: null })]
  assert.throws(
    () => parseLimitsRegisterRows(rows, SYNTHETIC_LABEL),
    /reason may be null only when basis is "unrecorded"/
  )
})

test('limits-register.accepts-an-unrecorded-row-with-a-null-reason', () => {
  const rows = [validRow({ basis: 'unrecorded', reason: null })]
  assert.doesNotThrow(() => parseLimitsRegisterRows(rows, SYNTHETIC_LABEL))
})

test('limits-register.refuses-a-row-that-is-not-an-object', () => {
  assert.throws(() => parseLimitsRegisterRows(['not-an-object'], SYNTHETIC_LABEL), /is not an object/)
})

test('limits-register.refuses-a-root-that-is-not-an-array', () => {
  assert.throws(() => parseLimitsRegisterRows({}, SYNTHETIC_LABEL), /must hold a JSON array/)
})

test('limits-register.refuses-an-empty-name', () => {
  assert.throws(() => parseLimitsRegisterRows([validRow({ name: '' })], SYNTHETIC_LABEL), /non-empty string "name"/)
})

test('limits-register.refuses-a-site-with-no-line-number', () => {
  assert.throws(() => parseLimitsRegisterRows([validRow({ site: 'src/example.ts' })], SYNTHETIC_LABEL), /"site" matching/)
})

test('limits-register.accepts-non-finite-values-as-the-two-spelled-strings', () => {
  assert.doesNotThrow(() => parseLimitsRegisterRows([validRow({ value: 'Infinity' })], SYNTHETIC_LABEL))
  assert.doesNotThrow(() => parseLimitsRegisterRows([validRow({ value: '-Infinity' })], SYNTHETIC_LABEL))
})

test('limits-register.refuses-a-non-finite-value-spelled-any-other-way', () => {
  assert.throws(() => parseLimitsRegisterRows([validRow({ value: Number.POSITIVE_INFINITY })], SYNTHETIC_LABEL), /neither a finite number/)
  assert.throws(() => parseLimitsRegisterRows([validRow({ value: 'infinity' })], SYNTHETIC_LABEL), /neither a finite number/)
})

test('limits-register.refuses-an-unknown-basis', () => {
  assert.throws(() => parseLimitsRegisterRows([validRow({ basis: 'guessed' })], SYNTHETIC_LABEL), /invalid "basis"/)
})

test('limits-register.refuses-mirrors-and-mirror-relation-disagreeing-on-nullness', () => {
  assert.throws(
    () => parseLimitsRegisterRows([validRow({ mirrors: 'src/other.ts:2', mirror_relation: null })], SYNTHETIC_LABEL),
    /disagree on nullness/
  )
  assert.throws(
    () => parseLimitsRegisterRows([validRow({ mirrors: null, mirror_relation: 'equal' })], SYNTHETIC_LABEL),
    /disagree on nullness/
  )
})

test('limits-register.accepts-a-consistent-mirror-pair', () => {
  assert.doesNotThrow(() =>
    parseLimitsRegisterRows([validRow({ mirrors: 'src/other.ts:2', mirror_relation: 'at-most' })], SYNTHETIC_LABEL)
  )
})

test('limits-register.refuses-a-row-with-an-unrecognised-key', () => {
  assert.throws(
    () => parseLimitsRegisterRows([validRow({ role: 'admin' })], SYNTHETIC_LABEL),
    /unrecognised key\(s\) role/
  )
})

test('limits-register.refuses-an-unrecorded-basis-with-a-non-null-reason', () => {
  assert.throws(
    () => parseLimitsRegisterRows([validRow({ basis: 'unrecorded', reason: 'measured once' })], SYNTHETIC_LABEL),
    /"unrecorded" means no reason was recorded, so reason must be null/
  )
})
