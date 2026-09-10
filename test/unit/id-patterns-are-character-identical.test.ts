import test from 'node:test'
import assert from 'node:assert/strict'
import * as ids from '../../src/schema/ids.ts'
import { THREAD_SLUG_MAX } from '../../src/schema/caps.ts'

type PatternExpectation = {
  source: string
  flags: string
}

const PATTERN_EXPECTATIONS: Record<string, PatternExpectation> = {
  ULID_PATTERN: {
    source: '^[0-9A-HJKMNP-TV-Z]{26}$',
    flags: ''
  },
  SLUG_PATTERN: {
    source: '^[a-z0-9][a-z0-9-]{0,63}$',
    flags: ''
  },
  ISO_PATTERN: {
    source: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    flags: ''
  },
  BRANCH_PATTERN: {
    source: '^(?!\\/)(?!.*\\.\\.)(?!.*\\/\\/)(?!.*\\.lock$)(?!.*\\/$)(?!.*\\.$)[A-Za-z0-9._/-]+$',
    flags: ''
  },
  SHA_PATTERN: {
    source: '^(?:[0-9a-f]{40}|[0-9a-f]{64})$',
    flags: ''
  }
}

test('id-patterns.every-exported-pattern-source-and-flags-are-pinned', () => {
  const exportedNames = Object.keys(ids)
  assert.ok(
    exportedNames.length > 0,
    'id-patterns: src/schema/ids.ts exported nothing; a pin over an empty population proves nothing'
  )
  for (const name of exportedNames) {
    const expected = PATTERN_EXPECTATIONS[name]
    assert.ok(
      expected !== undefined,
      `id-patterns: src/schema/ids.ts exports ${name}, which this test does not pin; add its source and flags to PATTERN_EXPECTATIONS`
    )
    const pattern = (ids as Record<string, RegExp>)[name]
    assert.ok(
      pattern !== undefined,
      `id-patterns: src/schema/ids.ts exports ${name} as undefined; a pin over a missing pattern proves nothing`
    )
    assert.equal(
      pattern.source,
      expected.source,
      `id-patterns: ${name}.source drifted from its pinned literal; five call sites compare .source as a string, so a semantically-identical rebuild that differs by even one character silently breaks value synthesis rather than failing there`
    )
    assert.equal(
      pattern.flags,
      expected.flags,
      `id-patterns: ${name}.flags drifted from the pinned value '${expected.flags}'; a rebuild via new RegExp(...) can silently change flags even when source stays untouched`
    )
  }
  for (const declaredName of Object.keys(PATTERN_EXPECTATIONS)) {
    assert.ok(
      exportedNames.includes(declaredName),
      `id-patterns: PATTERN_EXPECTATIONS names ${declaredName}, which src/schema/ids.ts no longer exports`
    )
  }
})

test('id-patterns.slug-pattern-quantifier-tracks-thread-slug-max', () => {
  const expectedSource = `^[a-z0-9][a-z0-9-]{0,${THREAD_SLUG_MAX - 1}}$`
  assert.equal(
    ids.SLUG_PATTERN.source,
    expectedSource,
    `id-patterns: SLUG_PATTERN's quantifier no longer equals THREAD_SLUG_MAX (${THREAD_SLUG_MAX}) minus the one mandatory leading character; the two must stay linked or slug-length validation and the cap it claims to enforce will disagree`
  )
})
