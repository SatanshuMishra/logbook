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

const HEADING_PATTERN = /^## (E\d+) — (.+)$/
const ANCHOR_PATTERN = /^- \*\*Anchor:\*\* `(.+)`$/
const ERRATA_METADATA_ROW_PATTERN = /^\|\s*\*\*Errata\*\*\s*\|/

type Erratum = { id: string; title: string; line: number; anchor: string | undefined }

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
    if (line === undefined || HEADING_PATTERN.test(line)) return undefined
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

const classifyAnchorVerbatim = (specText: string) => (entry: Erratum): Verdict => {
  if (entry.anchor === undefined) return 'unclassifiable'
  return specText.includes(entry.anchor) ? 'allowed' : 'unclassifiable'
}

const describeAnchorVerbatim = (entry: Erratum): string => {
  if (entry.anchor === undefined) {
    return `spec-errata-census: ${entry.id} carries no "- **Anchor:** \`...\`" line, so its anchor cannot be checked against ${SPEC_PATH}`
  }
  return `spec-errata-census: ${entry.id}'s anchor \`${entry.anchor}\` does not occur verbatim in ${SPEC_PATH}; an erratum whose anchor cannot be found in the specification corrects nothing`
}

const findErrataMetadataRow = (specText: string): string | undefined =>
  specText.split('\n').find((line) => ERRATA_METADATA_ROW_PATTERN.test(line))

test('spec-errata-census.the-population-of-errata-entries-is-non-empty', () => {
  const errata = readErrata(readErrataFile())
  guardNonEmpty(errata)
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

test('spec-errata-census.every-anchor-occurs-verbatim-in-the-specification', () => {
  const errata = readErrata(readErrataFile())
  guardNonEmpty(errata)
  const specText = readSpecFile()
  halts(errata, classifyAnchorVerbatim(specText), describeAnchorVerbatim)
})

test('spec-errata-census.every-anchor-occurs-verbatim-in-the-specification.control.a-fabricated-anchor-halts-while-a-real-one-passes', () => {
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
  assert.match(describeAnchorVerbatim(fabricatedAnchor), /E10/)
  assert.match(
    describeAnchorVerbatim(fabricatedAnchor),
    /a phrase invented for this control and never written in the fixture/
  )
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
