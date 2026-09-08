import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'

type Verdict = Classified<unknown>['verdict'] | 'unclassifiable'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ERRATA_PATH = path.join(ROOT, 'docs', 'specs', '2026-08-28-continuity-goal-model-errata.md')
const SPEC_PATH = path.join(ROOT, 'docs', 'specs', '2026-08-28-continuity-goal-model.md')
const ERRATA_RELATIVE_PATH = path.relative(ROOT, ERRATA_PATH).split(path.sep).join('/')

const toRepoRelative = (absolutePath: string): string => path.relative(ROOT, absolutePath).split(path.sep).join('/')

type SpecErrataFilePair = { readonly errataPath: string; readonly specPath: string }
type SpecErrataPair = SpecErrataFilePair & { readonly name: string }

const ERRATA_PAIR_NAME_DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}-/
const ERRATA_PAIR_NAME_SUFFIX_PATTERN = /-errata\.md$/

const deriveErrataPairName = (errataPath: string): string =>
  path
    .basename(errataPath)
    .replace(ERRATA_PAIR_NAME_DATE_PREFIX_PATTERN, '')
    .replace(ERRATA_PAIR_NAME_SUFFIX_PATTERN, '')

const PAIR_FILES: readonly SpecErrataFilePair[] = [
  {
    errataPath: ERRATA_PATH,
    specPath: SPEC_PATH
  },
  {
    errataPath: path.join(ROOT, 'docs', 'specs', '2026-09-06-continuity-recording-model-errata.md'),
    specPath: path.join(ROOT, 'docs', 'specs', '2026-09-06-continuity-recording-model.md')
  }
]

const PAIRS: readonly SpecErrataPair[] = PAIR_FILES.map((filePair) => ({
  ...filePair,
  name: deriveErrataPairName(filePair.errataPath)
}))

const SPECS_DIR = path.join(ROOT, 'docs', 'specs')

const HEADING_LINE_PATTERN = /^#{1,6} /
const HEADING_PATTERN = /^## (E\d+) — (.+)$/
const ERRATUM_ID_HINT_PATTERN = /E\d+/
const ANCHOR_PATTERN = /^- \*\*Anchor:\*\* `(.+)`$/
const ERRATA_METADATA_ROW_PATTERN = /^\|\s*\*\*Errata\*\*\s*\|/
const ERRATA_ROW_PATH_PATTERN = /`([^`]+)`/

type Erratum = { id: string; title: string; line: number; anchor: string | undefined }
type HeadingCandidate = { line: number; text: string }
type ErrataFileOnDisk = { relativePath: string }
type SpecFileCandidate = { relativePath: string; absolutePath: string }
type SpecFileWithErrataRow = { relativePath: string; errataRow: string }

const readErrataFile = (errataPath: string): string => {
  try {
    return readFileSync(errataPath, 'utf8')
  } catch (cause) {
    throw new Error(`spec-errata-census: could not read the errata document at ${errataPath}: ${String(cause)}`)
  }
}

const readSpecFile = (specPath: string): string => {
  try {
    return readFileSync(specPath, 'utf8')
  } catch (cause) {
    throw new Error(`spec-errata-census: could not read the specification at ${specPath}: ${String(cause)}`)
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

const readErrata = (text: string, errataPath: string): Erratum[] => {
  const lines = text.split('\n')
  const errata: Erratum[] = []
  for (const [index, line] of lines.entries()) {
    const matched = HEADING_PATTERN.exec(line)
    if (matched === null) continue
    const id = matched[1]
    const title = matched[2]
    if (id === undefined || title === undefined) {
      throw new Error(
        `spec-errata-census: ${errataPath}:${index + 1} matched a heading but yielded no identifier or title: ${line}`
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

const describeHeadingCandidate = (errataPath: string) => (candidate: HeadingCandidate): string =>
  `spec-errata-census: ${errataPath}:${candidate.line} names an erratum id but does not match "## E<n> — <title>" exactly: ${candidate.text}`

const guardNonEmpty = (errata: readonly Erratum[], errataPath: string): void => {
  assert.ok(
    errata.length > 0,
    `spec-errata-census: ${errataPath} yielded no "## E<n> — <title>" headings; a census over an empty population proves nothing`
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

const describeHasAnchor = (errataPath: string) => (entry: Erratum): string =>
  `spec-errata-census: ${errataPath}:${entry.line} ${entry.id} ("${entry.title}") carries no "- **Anchor:** \`...\`" line; every erratum must name a verbatim anchor in the specification it corrects`

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

const describeAnchorVerbatim = (specText: string, specPath: string) => (entry: Erratum): string => {
  if (entry.anchor === undefined) {
    return `spec-errata-census: ${entry.id} carries no "- **Anchor:** \`...\`" line, so its anchor cannot be checked against ${specPath}`
  }
  const count = countOccurrences(specText, entry.anchor)
  if (count === 0) {
    return `spec-errata-census: ${entry.id}'s anchor \`${entry.anchor}\` does not occur verbatim in ${specPath}; an erratum whose anchor cannot be found in the specification corrects nothing`
  }
  return `spec-errata-census: ${entry.id}'s anchor \`${entry.anchor}\` occurs ${count} times in ${specPath}; an anchor that does not occur exactly once is ambiguous about which site the erratum corrects`
}

const guardUniqueIds = (errata: readonly Erratum[], errataPath: string): void => {
  const counts = new Map<string, number>()
  for (const entry of errata) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
  }
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1)
  assert.equal(
    duplicated.length,
    0,
    `spec-errata-census: ${errataPath} repeats erratum id(s) ${duplicated
      .map(([id, count]) => `${id} (${count}×)`)
      .join(', ')}; a citation of a repeated id is ambiguous`
  )
}

const findErrataMetadataRow = (specText: string): string | undefined =>
  specText.split('\n').find((line) => ERRATA_METADATA_ROW_PATTERN.test(line))

const listErrataFilesOnDisk = (): ErrataFileOnDisk[] => {
  let entries: string[]
  try {
    entries = readdirSync(SPECS_DIR)
  } catch (cause) {
    throw new Error(`spec-errata-census: could not list ${SPECS_DIR}: ${String(cause)}`)
  }
  return entries
    .filter((entry) => entry.endsWith('-errata.md'))
    .map((entry) => ({ relativePath: toRepoRelative(path.join(SPECS_DIR, entry)) }))
}

const REGISTERED_ERRATA_RELATIVE_PATHS = new Set(PAIRS.map((pair) => toRepoRelative(pair.errataPath)))

const classifyErrataFileIsRegistered = (registered: ReadonlySet<string>) => (file: ErrataFileOnDisk): Verdict =>
  registered.has(file.relativePath) ? 'allowed' : 'unclassifiable'

const describeErrataFileIsRegistered = (file: ErrataFileOnDisk): string =>
  `spec-errata-census: ${file.relativePath} ends "-errata.md" under docs/specs but names no entry in the pair registry; an unregistered errata document is invisible to every census in this file, so its anchors could drift out of the specification with nothing to catch it`

const listSpecFilesOnDisk = (): SpecFileCandidate[] => {
  let entries: string[]
  try {
    entries = readdirSync(SPECS_DIR)
  } catch (cause) {
    throw new Error(`spec-errata-census: could not list ${SPECS_DIR}: ${String(cause)}`)
  }
  return entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => {
      const absolutePath = path.join(SPECS_DIR, entry)
      return { relativePath: toRepoRelative(absolutePath), absolutePath }
    })
}

const listSpecFilesWithErrataRow = (): SpecFileWithErrataRow[] =>
  listSpecFilesOnDisk().reduce<SpecFileWithErrataRow[]>((accumulated, candidate) => {
    const row = findErrataMetadataRow(readSpecFile(candidate.absolutePath))
    return row === undefined ? accumulated : [...accumulated, { relativePath: candidate.relativePath, errataRow: row }]
  }, [])

const extractErrataPathFromRow = (row: string): string | undefined => ERRATA_ROW_PATH_PATTERN.exec(row)?.[1]

const classifyErrataRowNamesRegisteredPath = (registered: ReadonlySet<string>) => (file: SpecFileWithErrataRow): Verdict => {
  const referencedPath = extractErrataPathFromRow(file.errataRow)
  return referencedPath !== undefined && registered.has(referencedPath) ? 'allowed' : 'unclassifiable'
}

const describeErrataRowNamesRegisteredPath = (file: SpecFileWithErrataRow): string => {
  const referencedPath = extractErrataPathFromRow(file.errataRow)
  if (referencedPath === undefined) {
    return `spec-errata-census: ${file.relativePath}'s "| **Errata** |" metadata row names no backtick-quoted path: ${file.errataRow}; without a parseable path, the errata document it points at cannot be checked against the pair registry`
  }
  return `spec-errata-census: ${file.relativePath}'s "| **Errata** |" metadata row names ${referencedPath}, which names no entry in the pair registry; a specification pointing at an unregistered errata document has corrections that no census in this file can verify`
}

const missingFilesForPair = (pair: SpecErrataPair): readonly string[] =>
  [pair.errataPath, pair.specPath].filter((candidate) => !existsSync(candidate))

const classifyPairFilesExist = (pair: SpecErrataPair): Verdict =>
  missingFilesForPair(pair).length === 0 ? 'allowed' : 'unclassifiable'

const describePairFilesExist = (pair: SpecErrataPair): string => {
  const missing = missingFilesForPair(pair)
  const verb = missing.length === 1 ? 'does not' : 'do not'
  return `spec-errata-census: registry entry "${pair.name}" names ${missing.join(' and ')}, which ${verb} exist on disk; a registered pair whose file is gone drops silently out of coverage`
}

test('spec-errata-census.the-pair-registry-includes-every-errata-file-on-disk', () => {
  const filesOnDisk = listErrataFilesOnDisk()
  assert.ok(
    filesOnDisk.length > 0,
    `spec-errata-census: ${SPECS_DIR} holds no file ending "-errata.md"; a census over an empty population proves nothing`
  )
  halts(filesOnDisk, classifyErrataFileIsRegistered(REGISTERED_ERRATA_RELATIVE_PATHS), describeErrataFileIsRegistered)
})

test('spec-errata-census.the-pair-registry-includes-every-errata-file-on-disk.control.an-unregistered-disk-file-halts-while-a-registered-one-passes', () => {
  const registeredExample: ErrataFileOnDisk = { relativePath: 'docs/specs/2026-01-01-fixture-errata.md' }
  const unregisteredExample: ErrataFileOnDisk = { relativePath: 'docs/specs/2099-01-01-fixture-errata.md' }
  const fixtureRegistry = new Set([registeredExample.relativePath])
  const classify = classifyErrataFileIsRegistered(fixtureRegistry)

  assert.equal(classify(registeredExample), 'allowed')
  assert.equal(classify(unregisteredExample), 'unclassifiable')
  assert.throws(
    () => census([registeredExample, unregisteredExample], classify),
    /census halted on an unclassifiable item/,
    'an errata file on disk with no registry entry must halt the census'
  )
  assert.doesNotThrow(() => census([registeredExample], classify))
  assert.match(describeErrataFileIsRegistered(unregisteredExample), /2099-01-01-fixture-errata\.md/)
})

test('spec-errata-census.every-specification-with-an-errata-row-names-a-registered-errata-path', () => {
  const specsWithErrataRow = listSpecFilesWithErrataRow()
  assert.ok(
    specsWithErrataRow.length > 0,
    `spec-errata-census: no specification under ${SPECS_DIR} carries an "| **Errata** |" metadata row; a census over an empty population proves nothing`
  )
  halts(
    specsWithErrataRow,
    classifyErrataRowNamesRegisteredPath(REGISTERED_ERRATA_RELATIVE_PATHS),
    describeErrataRowNamesRegisteredPath
  )
})

test('spec-errata-census.every-specification-with-an-errata-row-names-a-registered-errata-path.control.an-unregistered-target-halts-while-a-registered-one-passes', () => {
  const registeredPath = 'docs/specs/2026-01-01-fixture-errata.md'
  const fixtureRegistry = new Set([registeredPath])
  const registeredExample: SpecFileWithErrataRow = {
    relativePath: 'docs/specs/2026-01-01-fixture.md',
    errataRow: `| **Errata** | Corrections live in \`${registeredPath}\`. |`
  }
  const unregisteredExample: SpecFileWithErrataRow = {
    relativePath: 'docs/specs/2026-01-02-fixture.md',
    errataRow: '| **Errata** | Corrections live in `docs/specs/2026-01-02-fixture-errata.md`. |'
  }
  const classify = classifyErrataRowNamesRegisteredPath(fixtureRegistry)

  assert.equal(classify(registeredExample), 'allowed')
  assert.equal(classify(unregisteredExample), 'unclassifiable')
  assert.throws(
    () => census([registeredExample, unregisteredExample], classify),
    /census halted on an unclassifiable item/,
    'a specification whose errata row names an unregistered path must halt the census'
  )
  assert.doesNotThrow(() => census([registeredExample], classify))
  assert.match(describeErrataRowNamesRegisteredPath(unregisteredExample), /2026-01-02-fixture-errata\.md/)
})

test('spec-errata-census.every-registry-entry-names-files-that-exist-on-disk', () => {
  assert.ok(
    PAIRS.length > 0,
    'spec-errata-census: the pair registry is empty; a census over an empty population proves nothing'
  )
  halts(PAIRS, classifyPairFilesExist, describePairFilesExist)
})

test('spec-errata-census.every-registry-entry-names-files-that-exist-on-disk.control.a-registry-entry-naming-a-missing-file-halts-while-a-real-pair-passes', () => {
  const missingFilePair: SpecErrataPair = {
    name: 'fixture-with-a-missing-errata-file',
    errataPath: path.join(ROOT, 'docs', 'specs', 'this-errata-file-does-not-exist-errata.md'),
    specPath: SPEC_PATH
  }
  const realPair: SpecErrataPair = { name: 'fixture-real-pair', errataPath: ERRATA_PATH, specPath: SPEC_PATH }

  assert.equal(classifyPairFilesExist(missingFilePair), 'unclassifiable')
  assert.equal(classifyPairFilesExist(realPair), 'allowed')
  assert.throws(
    () => census([realPair, missingFilePair], classifyPairFilesExist),
    /census halted on an unclassifiable item/,
    'a registry entry naming a file absent from disk must halt the census'
  )
  assert.doesNotThrow(() => census([realPair], classifyPairFilesExist))
  assert.match(describePairFilesExist(missingFilePair), /this-errata-file-does-not-exist-errata\.md/)
})

for (const pair of PAIRS) {
  test(`spec-errata-census.${pair.name}.the-population-of-errata-entries-is-non-empty`, () => {
    const errata = readErrata(readErrataFile(pair.errataPath), pair.errataPath)
    guardNonEmpty(errata, pair.errataPath)
  })
}

for (const pair of PAIRS) {
  test(`spec-errata-census.${pair.name}.every-heading-that-names-an-erratum-id-matches-the-heading-pattern-exactly`, () => {
    const candidates = extractHeadingCandidates(readErrataFile(pair.errataPath))
    assert.ok(
      candidates.length > 0,
      `spec-errata-census: ${pair.errataPath} holds no markdown heading at all; a census over an empty population proves nothing`
    )
    halts(candidates, classifyHeadingCandidate, describeHeadingCandidate(pair.errataPath))
  })
}

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

for (const pair of PAIRS) {
  test(`spec-errata-census.${pair.name}.every-erratum-carries-an-anchor-line`, () => {
    const errata = readErrata(readErrataFile(pair.errataPath), pair.errataPath)
    guardNonEmpty(errata, pair.errataPath)
    halts(errata, classifyHasAnchor, describeHasAnchor(pair.errataPath))
  })
}

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
  assert.match(describeHasAnchor(ERRATA_PATH)(withoutAnchor), /E10/)
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
  const parsed = readErrata(fixture, ERRATA_PATH)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]?.anchor, undefined)
})

for (const pair of PAIRS) {
  test(`spec-errata-census.${pair.name}.every-erratum-id-is-unique`, () => {
    const errata = readErrata(readErrataFile(pair.errataPath), pair.errataPath)
    guardNonEmpty(errata, pair.errataPath)
    guardUniqueIds(errata, pair.errataPath)
  })
}

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
  const errata = readErrata(fixture, ERRATA_PATH)
  assert.equal(errata.length, 2)
  assert.throws(
    () => guardUniqueIds(errata, ERRATA_PATH),
    /E1 \(2×\)/,
    'a duplicated erratum id must fail the uniqueness guard, named with its count'
  )

  const withoutDuplicate = readErrata(['## E1 — first entry', '', '- **Anchor:** `first anchor text`'].join('\n'), ERRATA_PATH)
  assert.doesNotThrow(() => guardUniqueIds(withoutDuplicate, ERRATA_PATH))
})

for (const pair of PAIRS) {
  test(`spec-errata-census.${pair.name}.every-anchor-occurs-exactly-once-in-the-specification`, () => {
    const errata = readErrata(readErrataFile(pair.errataPath), pair.errataPath)
    guardNonEmpty(errata, pair.errataPath)
    const specText = readSpecFile(pair.specPath)
    halts(errata, classifyAnchorVerbatim(specText), describeAnchorVerbatim(specText, pair.specPath))
  })
}

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
  assert.match(describeAnchorVerbatim(specText, SPEC_PATH)(fabricatedAnchor), /E10/)
  assert.match(
    describeAnchorVerbatim(specText, SPEC_PATH)(fabricatedAnchor),
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
  assert.match(describeAnchorVerbatim(specText, SPEC_PATH)(repeatedAnchor), /E12/)
  assert.match(describeAnchorVerbatim(specText, SPEC_PATH)(repeatedAnchor), /occurs 2 times/)
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
  const parsed = readErrata(fixture, ERRATA_PATH)
  assert.deepEqual(
    parsed.map((entry) => entry.id),
    ['E7', 'E8']
  )
  assert.equal(parsed[0]?.anchor, 'a fixture anchor value')
  assert.equal(parsed[1]?.anchor, undefined)
})

for (const pair of PAIRS) {
  test(`spec-errata-census.${pair.name}.the-specification-points-at-the-errata-document`, () => {
    const specText = readSpecFile(pair.specPath)
    const row = findErrataMetadataRow(specText)
    const errataRelativePath = toRepoRelative(pair.errataPath)
    assert.ok(
      row !== undefined,
      `spec-errata-census: ${pair.specPath} carries no "| **Errata** | ... |" metadata row; without one, a correction recorded in the errata document is unreachable from the document it corrects`
    )
    assert.ok(
      row.includes(errataRelativePath),
      `spec-errata-census: the "| **Errata** |" metadata row in ${pair.specPath} does not name ${errataRelativePath}; without a pointer from the specification to its errata, a correction recorded there is unreachable from the document it corrects`
    )
  })
}

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
