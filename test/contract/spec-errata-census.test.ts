import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'

type Verdict = Classified<unknown>['verdict'] | 'unclassifiable'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ERRATA_PATH = path.join(ROOT, 'docs', 'specs', '2026-08-28-continuity-goal-model-errata.md')
const SPEC_PATH = path.join(ROOT, 'docs', 'specs', '2026-08-28-continuity-goal-model.md')
const ERRATA_RELATIVE_PATH = path.relative(ROOT, ERRATA_PATH).split(path.sep).join('/')

const HEADING_LINE_PATTERN = /^#{1,6} /
const HEADING_PATTERN = /^## (E\d+) — (.+)$/
const ERRATUM_ID_HINT_PATTERN = /E\d+/
const ANCHOR_PATTERN = /^- \*\*Anchor:\*\* `(.+)`$/
const ERRATA_METADATA_ROW_PATTERN = /^\|\s*\*\*Errata\*\*\s*\|/

type Erratum = { id: string; title: string; line: number; anchor: string | undefined }
type HeadingCandidate = { line: number; text: string }

const readErrataFile = (): string => {
  try {
    return readFileSync(ERRATA_PATH, 'utf8')
  } catch (cause) {
    throw new Error(`spec-errata-census: could not read the errata document at ${ERRATA_PATH}: ${String(cause)}`)
  }
}

const readSpecFile = (): string => {
  try {
    return readFileSync(SPEC_PATH, 'utf8')
  } catch (cause) {
    throw new Error(`spec-errata-census: could not read the specification at ${SPEC_PATH}: ${String(cause)}`)
  }
}

const findAnchorForEntry = (lines: readonly string[], headingIndex: number): string | undefined => {
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || HEADING_LINE_PATTERN.test(line)) return undefined
    const matched = ANCHOR_PATTERN.exec(line)
    if (matched !== null) return matched[1]
  }
  return undefined
}

const readErrata = (text: string): Erratum[] => {
  const lines = text.split('\n')
  const errata: Erratum[] = []
  for (const [index, line] of lines.entries()) {
    const matched = HEADING_PATTERN.exec(line)
    if (matched === null) continue
    const id = matched[1]
    const title = matched[2]
    if (id === undefined || title === undefined) {
      throw new Error(
        `spec-errata-census: ${ERRATA_PATH}:${index + 1} matched a heading but yielded no identifier or title: ${line}`
      )
    }
    errata.push({ id, title, line: index + 1, anchor: findAnchorForEntry(lines, index) })
  }
  return errata
}

const extractHeadingCandidates = (text: string): HeadingCandidate[] =>
  text
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((candidate) => HEADING_LINE_PATTERN.test(candidate.text))

const classifyHeadingCandidate = (candidate: HeadingCandidate): Verdict => {
  if (HEADING_PATTERN.test(candidate.text)) return 'allowed'
  if (ERRATUM_ID_HINT_PATTERN.test(candidate.text)) return 'unclassifiable'
  return 'allowed'
}

const describeHeadingCandidate = (candidate: HeadingCandidate): string =>
  `spec-errata-census: ${ERRATA_PATH}:${candidate.line} names an erratum id but does not match "## E<n> — <title>" exactly: ${candidate.text}`

const guardNonEmpty = (errata: readonly Erratum[]): void => {
  assert.ok(
    errata.length > 0,
    `spec-errata-census: ${ERRATA_PATH} yielded no "## E<n> — <title>" headings; a census over an empty population proves nothing`
  )
}

const firstFailure = <T>(items: readonly T[], classify: (item: T) => Verdict, describe: (item: T) => string): string => {
  for (const item of items) {
    if (classify(item) !== 'allowed') return describe(item)
  }
  return 'no item failed this census'
}

const halts = <T>(items: readonly T[], classify: (item: T) => Verdict, describe: (item: T) => string): void => {
  assert.doesNotThrow(() => census([...items], classify), firstFailure(items, classify, describe))
}

const classifyHasAnchor = (entry: Erratum): Verdict => (entry.anchor === undefined ? 'unclassifiable' : 'allowed')

const describeHasAnchor = (entry: Erratum): string =>
  `spec-errata-census: ${entry.id} ("${entry.title}") carries no "- **Anchor:** \`...\`" line; every erratum must name a verbatim anchor in the specification it corrects`

const countOccurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

const classifyAnchorVerbatim = (specText: string) => (entry: Erratum): Verdict => {
  if (entry.anchor === undefined) return 'unclassifiable'
  return countOccurrences(specText, entry.anchor) === 1 ? 'allowed' : 'unclassifiable'
}

const describeAnchorVerbatim = (specText: string) => (entry: Erratum): string => {
  if (entry.anchor === undefined) {
    return `spec-errata-census: ${entry.id} carries no "- **Anchor:** \`...\`" line, so its anchor cannot be checked against ${SPEC_PATH}`
  }
  const count = countOccurrences(specText, entry.anchor)
  if (count === 0) {
    return `spec-errata-census: ${entry.id}'s anchor \`${entry.anchor}\` does not occur verbatim in ${SPEC_PATH}; an erratum whose anchor cannot be found in the specification corrects nothing`
  }
  return `spec-errata-census: ${entry.id}'s anchor \`${entry.anchor}\` occurs ${count} times in ${SPEC_PATH}; an anchor that does not occur exactly once is ambiguous about which site the erratum corrects`
}

const guardUniqueIds = (errata: readonly Erratum[]): void => {
  const counts = new Map<string, number>()
  for (const entry of errata) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
  }
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1)
  assert.equal(
    duplicated.length,
    0,
    `spec-errata-census: ${ERRATA_PATH} repeats erratum id(s) ${duplicated
      .map(([id, count]) => `${id} (${count}×)`)
      .join(', ')}; a citation of a repeated id is ambiguous`
  )
}

const findErrataMetadataRow = (specText: string): string | undefined =>
  specText.split('\n').find((line) => ERRATA_METADATA_ROW_PATTERN.test(line))

test('spec-errata-census.the-population-of-errata-entries-is-non-empty', () => {
  const errata = readErrata(readErrataFile())
  guardNonEmpty(errata)
})

test('spec-errata-census.every-heading-that-names-an-erratum-id-matches-the-heading-pattern-exactly', () => {
  const candidates = extractHeadingCandidates(readErrataFile())
  assert.ok(
    candidates.length > 0,
    `spec-errata-census: ${ERRATA_PATH} holds no markdown heading at all; a census over an empty population proves nothing`
  )
  halts(candidates, classifyHeadingCandidate, describeHeadingCandidate)
})

test('spec-errata-census.every-heading-that-names-an-erratum-id-matches-the-heading-pattern-exactly.control.a-near-miss-heading-halts-the-census', () => {
  const hyphenForm: HeadingCandidate = { line: 1, text: '## E4 - hyphen form' }
  const enDashForm: HeadingCandidate = { line: 2, text: '## E4 – en dash form' }
  const deeperLevel: HeadingCandidate = { line: 3, text: '### E4 — deeper' }
  const genuine: HeadingCandidate = { line: 4, text: '## E4 — genuine form' }

  assert.equal(classifyHeadingCandidate(hyphenForm), 'unclassifiable')
  assert.equal(classifyHeadingCandidate(enDashForm), 'unclassifiable')
  assert.equal(classifyHeadingCandidate(deeperLevel), 'unclassifiable')
  assert.equal(classifyHeadingCandidate(genuine), 'allowed')

  for (const nearMiss of [hyphenForm, enDashForm, deeperLevel]) {
    assert.throws(
      () => census([nearMiss], classifyHeadingCandidate),
      /census halted on an unclassifiable item/,
      `a near-miss heading must halt the census: ${nearMiss.text}`
    )
  }
  assert.doesNotThrow(() => census([genuine], classifyHeadingCandidate))
})

test('spec-errata-census.every-heading-that-names-an-erratum-id-matches-the-heading-pattern-exactly.control.a-genuine-non-erratum-heading-is-allowed', () => {
  const documentTitle: HeadingCandidate = { line: 1, text: '# Errata: SPEC Continuity Goal Model' }
  const futureProseSection: HeadingCandidate = { line: 2, text: '## Appendix' }

  assert.equal(classifyHeadingCandidate(documentTitle), 'allowed')
  assert.equal(classifyHeadingCandidate(futureProseSection), 'allowed')
  assert.doesNotThrow(() => census([documentTitle, futureProseSection], classifyHeadingCandidate))
})

test('spec-errata-census.every-erratum-carries-an-anchor-line', () => {
  const errata = readErrata(readErrataFile())
  guardNonEmpty(errata)
  halts(errata, classifyHasAnchor, describeHasAnchor)
})

test('spec-errata-census.every-erratum-carries-an-anchor-line.control.an-entry-without-an-anchor-line-halts-while-one-with-passes', () => {
  const withAnchor: Erratum = { id: 'E9', title: 'a fixture entry', line: 1, anchor: 'some fixture text' }
  const withoutAnchor: Erratum = { id: 'E10', title: 'another fixture entry', line: 5, anchor: undefined }

  assert.equal(classifyHasAnchor(withAnchor), 'allowed')
  assert.equal(classifyHasAnchor(withoutAnchor), 'unclassifiable')
  assert.throws(
    () => census([withAnchor, withoutAnchor], classifyHasAnchor),
    /census halted on an unclassifiable item/,
    'an entry with no Anchor line must halt the census'
  )
  assert.doesNotThrow(() => census([withAnchor], classifyHasAnchor))
  assert.match(describeHasAnchor(withoutAnchor), /E10/)
})

test('spec-errata-census.the-heading-and-anchor-parser-does-not-borrow-an-anchor-from-a-later-section', () => {
  const fixture = [
    '## E1 — no anchor of its own',
    '',
    '- **Ground:** this entry never states an anchor',
    '',
    '## Appendix',
    '',
    '- **Anchor:** `borrowed`'
  ].join('\n')
  const parsed = readErrata(fixture)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]?.anchor, undefined)
})

test('spec-errata-census.every-erratum-id-is-unique', () => {
  const errata = readErrata(readErrataFile())
  guardNonEmpty(errata)
  guardUniqueIds(errata)
})

test('spec-errata-census.every-erratum-id-is-unique.control.a-duplicated-id-fails-named-with-its-count', () => {
  const fixture = [
    '## E1 — first entry',
    '',
    '- **Anchor:** `first anchor text`',
    '',
    '## E1 — a second entry using the same id',
    '',
    '- **Anchor:** `second anchor text`'
  ].join('\n')
  const errata = readErrata(fixture)
  assert.equal(errata.length, 2)
  assert.throws(
    () => guardUniqueIds(errata),
    /E1 \(2×\)/,
    'a duplicated erratum id must fail the uniqueness guard, named with its count'
  )

  const withoutDuplicate = readErrata(['## E1 — first entry', '', '- **Anchor:** `first anchor text`'].join('\n'))
  assert.doesNotThrow(() => guardUniqueIds(withoutDuplicate))
})

test('spec-errata-census.every-anchor-occurs-exactly-once-in-the-specification', () => {
  const errata = readErrata(readErrataFile())
  guardNonEmpty(errata)
  const specText = readSpecFile()
  halts(errata, classifyAnchorVerbatim(specText), describeAnchorVerbatim(specText))
})

test('spec-errata-census.every-anchor-occurs-exactly-once-in-the-specification.control.a-fabricated-anchor-halts-while-a-real-one-passes', () => {
  const specText = 'The quick brown fox jumps over the lazy dog.'
  const realAnchor: Erratum = { id: 'E9', title: 'a fixture entry', line: 1, anchor: 'quick brown fox' }
  const fabricatedAnchor: Erratum = {
    id: 'E10',
    title: 'a second fixture entry',
    line: 2,
    anchor: 'a phrase invented for this control and never written in the fixture'
  }
  const missingAnchor: Erratum = { id: 'E11', title: 'a third fixture entry', line: 3, anchor: undefined }

  assert.equal(classifyAnchorVerbatim(specText)(realAnchor), 'allowed')
  assert.equal(classifyAnchorVerbatim(specText)(fabricatedAnchor), 'unclassifiable')
  assert.equal(classifyAnchorVerbatim(specText)(missingAnchor), 'unclassifiable')
  assert.doesNotThrow(() => census([realAnchor], classifyAnchorVerbatim(specText)))
  assert.throws(
    () => census([realAnchor, fabricatedAnchor], classifyAnchorVerbatim(specText)),
    /census halted on an unclassifiable item/,
    'a fabricated anchor absent from the specification must halt the census'
  )
  assert.match(describeAnchorVerbatim(specText)(fabricatedAnchor), /E10/)
  assert.match(
    describeAnchorVerbatim(specText)(fabricatedAnchor),
    /a phrase invented for this control and never written in the fixture/
  )
})

test('spec-errata-census.every-anchor-occurs-exactly-once-in-the-specification.control.a-repeated-anchor-halts-with-its-count-stated-while-a-unique-one-passes', () => {
  const specText = 'quick brown fox jumps; a quick brown fox naps.'
  const repeatedAnchor: Erratum = { id: 'E12', title: 'a repeated-anchor fixture entry', line: 1, anchor: 'quick brown fox' }
  const uniqueAnchor: Erratum = { id: 'E13', title: 'a unique-anchor fixture entry', line: 2, anchor: 'jumps; a quick' }

  assert.equal(classifyAnchorVerbatim(specText)(repeatedAnchor), 'unclassifiable')
  assert.equal(classifyAnchorVerbatim(specText)(uniqueAnchor), 'allowed')
  assert.throws(
    () => census([repeatedAnchor], classifyAnchorVerbatim(specText)),
    /census halted on an unclassifiable item/,
    'an anchor occurring more than once in the specification must halt the census'
  )
  assert.doesNotThrow(() => census([uniqueAnchor], classifyAnchorVerbatim(specText)))
  assert.match(describeAnchorVerbatim(specText)(repeatedAnchor), /E12/)
  assert.match(describeAnchorVerbatim(specText)(repeatedAnchor), /occurs 2 times/)
})

test('spec-errata-census.the-heading-and-anchor-parser-reads-the-real-em-dash-heading-form', () => {
  const fixture = [
    '## E7 — a fixture heading using the real em dash',
    '',
    '- **Ground:** filler line before the anchor is irrelevant',
    '- **Anchor:** `a fixture anchor value`',
    '',
    '## E8 — a fixture heading with no anchor line at all',
    '',
    '- **Ground:** this entry never states an anchor'
  ].join('\n')
  const parsed = readErrata(fixture)
  assert.deepEqual(
    parsed.map((entry) => entry.id),
    ['E7', 'E8']
  )
  assert.equal(parsed[0]?.anchor, 'a fixture anchor value')
  assert.equal(parsed[1]?.anchor, undefined)
})

test('spec-errata-census.the-specification-points-at-the-errata-document', () => {
  const specText = readSpecFile()
  const row = findErrataMetadataRow(specText)
  assert.ok(
    row !== undefined,
    `spec-errata-census: ${SPEC_PATH} carries no "| **Errata** | ... |" metadata row; without one, a correction recorded in the errata document is unreachable from the document it corrects`
  )
  assert.ok(
    row.includes(ERRATA_RELATIVE_PATH),
    `spec-errata-census: the "| **Errata** |" metadata row in ${SPEC_PATH} does not name ${ERRATA_RELATIVE_PATH}; without a pointer from the specification to its errata, a correction recorded there is unreachable from the document it corrects`
  )
})

test('spec-errata-census.the-specification-points-at-the-errata-document.control.a-missing-metadata-row-is-refused-while-a-present-one-passes', () => {
  const withRow = [
    '| **Date** | 2026-08-28 |',
    `| **Errata** | Corrections live in \`${ERRATA_RELATIVE_PATH}\`. |`
  ].join('\n')
  const withoutRow = ['| **Date** | 2026-08-28 |', '| **Status** | Approved |'].join('\n')
  const withWrongTarget = ['| **Date** | 2026-08-28 |', '| **Errata** | Corrections live in `docs/specs/elsewhere.md`. |'].join(
    '\n'
  )

  assert.notEqual(findErrataMetadataRow(withRow), undefined)
  assert.equal(findErrataMetadataRow(withoutRow), undefined)
  const wrongRow = findErrataMetadataRow(withWrongTarget)
  assert.notEqual(wrongRow, undefined)
  assert.equal(wrongRow?.includes(ERRATA_RELATIVE_PATH), false)
})
