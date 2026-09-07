import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'

type Verdict = Classified<unknown>['verdict'] | 'unclassifiable'
type TableKind = 'assertion' | 'invariant'
type Disposition = { kind: TableKind; columns: number; idPattern: RegExp }
type TableSource = Disposition & { label: string }
type DiscoveredTable = { source: TableSource; headingIndex: number; headerIndex: number; limit: number }
type Row = {
  table: string
  kind: TableKind
  line: number
  text: string
  id: string | undefined
  statement: string | undefined
  tracesTo: string | undefined
}
type ParsedRow = { table: string; line: number; id: string; statement: string }
type Needle = { assertionId: string; text: string }
type CoverageLine = { where: string; text: string }

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SPEC_PATH = path.join(ROOT, 'docs', 'specs', '2026-09-06-continuity-recording-model.md')

const MINIMUM_STATEMENT_CHARACTERS = 16

const ASSERTION_SECTION = 5
const INVARIANT_SECTION = 6
const SECTION_AFTER_INVARIANTS = 7

const HEADING_LINE_PATTERN = /^#{1,6} /
const SECTION_HEADING_PATTERN = /^## (\d+)\. /
const TABLE_HEADING_PATTERN = /^### (\d+)\.(\d+) /
const TABLE_LABEL_PATTERN = /^(\d+)\.(\d+)$/
const SEPARATOR_ROW_PATTERN = /^\|[\s\-:|]+\|$/
const BOLD_CELL_PATTERN = /^\*\*(.+)\*\*$/
const ASSERTION_ID_PATTERN = /^R-\d+$/
const INVARIANT_ID_PATTERN = /^[AOS]\d+$/
const ASSERTION_ID_MENTION_PATTERN = /R-\d+/
const SERIES_PATTERN = /^([A-Z]-?)(\d+)$/
const SENTENCE_BOUNDARY_PATTERN = /(?<=\.)\s+/
const COVERAGE_TOKEN_PATTERN = /`([A-Z]-?\d+)`–`([A-Z]-?\d+)`|`([A-Z]-?\d+)`/g
const EMPHASIS_PATTERN = /\*\*/g
const BACKTICK_PATTERN = /`/g
const WHITESPACE_RUN_PATTERN = /\s+/g
const TRAILING_PUNCTUATION_PATTERN = /[.,;:]+$/

const INVARIANT_COVERAGE_PREFIX = '**Every invariant belongs to a unit.**'
const ASSERTION_COVERAGE_PREFIX = '**Every assertion reaches a rendered surface**'

const MATCHING_PREDICATE =
  'containment in either direction, after stripping ** and backticks, lowercasing, collapsing whitespace runs and dropping trailing punctuation, applied to each whole assertion and to each of its sentences'

const DISPOSITION_BY_SECTION: ReadonlyMap<number, Disposition> = new Map([
  [ASSERTION_SECTION, { kind: 'assertion', columns: 2, idPattern: ASSERTION_ID_PATTERN }],
  [INVARIANT_SECTION, { kind: 'invariant', columns: 3, idPattern: INVARIANT_ID_PATTERN }]
])

const tableSource = (label: string): TableSource => {
  const matched = TABLE_LABEL_PATTERN.exec(label)
  if (matched === null) {
    throw new Error(
      `assertions-are-not-invariants: the table label ${JSON.stringify(label)} does not read as <section>.<ordinal>, and this census dispositions a table on its section number alone, never on its heading prose`
    )
  }
  const section = Number(matched[1] ?? '')
  const disposition = DISPOSITION_BY_SECTION.get(section)
  if (disposition === undefined) {
    throw new Error(
      `assertions-are-not-invariants: table ${label} sits under section ${section}, for which no column count or id shape is declared; sections ${ASSERTION_SECTION} and ${INVARIANT_SECTION} are the only ones this census reads`
    )
  }
  return { label, ...disposition }
}

const readSpecFile = (): string => {
  try {
    return readFileSync(SPEC_PATH, 'utf8')
  } catch (cause) {
    throw new Error(`assertions-are-not-invariants: could not read the specification at ${SPEC_PATH}: ${String(cause)}`)
  }
}

const normalise = (text: string): string =>
  text
    .replace(EMPHASIS_PATTERN, '')
    .replace(BACKTICK_PATTERN, '')
    .toLowerCase()
    .replace(WHITESPACE_RUN_PATTERN, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION_PATTERN, '')
    .trim()

const sentencesOf = (statement: string): string[] =>
  statement
    .split(SENTENCE_BOUNDARY_PATTERN)
    .map((part) => normalise(part))
    .filter((part) => part.length > 0)

const splitCells = (text: string): string[] | undefined => {
  if (text.length < 2) return undefined
  if (!text.startsWith('|') || !text.endsWith('|')) return undefined
  return text
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

const findSoleSectionHeading = (lines: readonly string[], section: number): number => {
  const found = lines.flatMap((line, index) => {
    const matched = SECTION_HEADING_PATTERN.exec(line)
    return matched !== null && Number(matched[1] ?? '') === section ? [index] : []
  })
  const only = found[0]
  if (found.length !== 1 || only === undefined) {
    throw new Error(
      `assertions-are-not-invariants: ${SPEC_PATH} carries ${found.length} headings of the form "## ${section}. "; this census brackets its tables between "## ${ASSERTION_SECTION}. " and "## ${SECTION_AFTER_INVARIANTS}. " and cannot bracket them without exactly one of each`
    )
  }
  return only
}

const subsectionLimit = (lines: readonly string[], headingIndex: number, end: number): number => {
  for (let index = headingIndex + 1; index < end; index += 1) {
    if (HEADING_LINE_PATTERN.test(lines[index] ?? '')) return index
  }
  return end
}

const findHeaderRow = (lines: readonly string[], headingIndex: number, limit: number): number => {
  for (let index = headingIndex + 1; index < limit; index += 1) {
    if ((lines[index] ?? '').startsWith('|')) return index
  }
  return -1
}

const discoverTables = (lines: readonly string[]): DiscoveredTable[] => {
  const start = findSoleSectionHeading(lines, ASSERTION_SECTION)
  const end = findSoleSectionHeading(lines, SECTION_AFTER_INVARIANTS)
  if (end <= start) {
    throw new Error(
      `assertions-are-not-invariants: ${SPEC_PATH} places "## ${SECTION_AFTER_INVARIANTS}. " at line ${end + 1}, at or before "## ${ASSERTION_SECTION}. " at line ${start + 1}, so the two bracket no text at all`
    )
  }
  const discovered: DiscoveredTable[] = []
  for (let index = start + 1; index < end; index += 1) {
    const heading = lines[index] ?? ''
    const matched = TABLE_HEADING_PATTERN.exec(heading)
    if (matched === null) continue
    const limit = subsectionLimit(lines, index, end)
    const headerIndex = findHeaderRow(lines, index, limit)
    if (headerIndex === -1) continue
    const label = `${matched[1] ?? ''}.${matched[2] ?? ''}`
    discovered.push({ source: tableSource(label), headingIndex: index, headerIndex, limit })
  }
  return discovered
}

const parseRow = (source: TableSource, line: number, text: string): Row => {
  const unparsed: Row = {
    table: source.label,
    kind: source.kind,
    line,
    text,
    id: undefined,
    statement: undefined,
    tracesTo: undefined
  }
  const cells = splitCells(text)
  if (cells === undefined || cells.length !== source.columns) return unparsed
  const idCell = cells[0]
  const statement = cells[1]
  if (idCell === undefined || statement === undefined) return unparsed
  const bold = BOLD_CELL_PATTERN.exec(idCell)
  if (bold === null) return unparsed
  const id = (bold[1] ?? '').trim()
  if (!source.idPattern.test(id)) return unparsed
  if (statement.length === 0) return unparsed
  if (source.columns === 2) {
    return { table: source.label, kind: source.kind, line, text, id, statement, tracesTo: undefined }
  }
  const tracesTo = cells[2]
  if (tracesTo === undefined || tracesTo.length === 0) return unparsed
  return { table: source.label, kind: source.kind, line, text, id, statement, tracesTo }
}

const collectRows = (lines: readonly string[], table: DiscoveredTable): Row[] => {
  const headerCells = splitCells(lines[table.headerIndex] ?? '')
  if (headerCells === undefined || headerCells.length !== table.source.columns) {
    throw new Error(
      `assertions-are-not-invariants: ${SPEC_PATH}:${table.headerIndex + 1} is the header row of table ${table.source.label} but reads as ${headerCells === undefined ? 'no table row at all' : `${headerCells.length} cells`} where a ${table.source.kind} table carries ${table.source.columns}`
    )
  }
  const separator = lines[table.headerIndex + 1] ?? ''
  if (!SEPARATOR_ROW_PATTERN.test(separator)) {
    throw new Error(
      `assertions-are-not-invariants: ${SPEC_PATH}:${table.headerIndex + 2} does not read as a markdown table separator beneath the header of table ${table.source.label}: ${separator}`
    )
  }
  const rows: Row[] = []
  for (let index = table.headerIndex + 2; index < table.limit; index += 1) {
    const text = lines[index] ?? ''
    if (text.trim() === '') break
    rows.push(parseRow(table.source, index + 1, text))
  }
  if (rows.length === 0) {
    throw new Error(
      `assertions-are-not-invariants: table ${table.source.label} at ${SPEC_PATH}:${table.headingIndex + 1} carries no data row; a census over an empty list proves nothing`
    )
  }
  return rows
}

const guardEverySectionYieldedATable = (tables: readonly DiscoveredTable[]): void => {
  for (const section of DISPOSITION_BY_SECTION.keys()) {
    assert.ok(
      tables.some((table) => table.source.label.startsWith(`${section}.`)),
      `assertions-are-not-invariants: scanning ${SPEC_PATH} between "## ${ASSERTION_SECTION}. " and "## ${SECTION_AFTER_INVARIANTS}. " discovered no "### ${section}.<n> " heading carrying a markdown table; a scan that silently matched nothing would report a green census over no rows at all`
    )
  }
}

const readTables = (): { lines: string[]; assertions: Row[]; invariants: Row[]; all: Row[] } => {
  const lines = readSpecFile().split('\n')
  const tables = discoverTables(lines)
  guardEverySectionYieldedATable(tables)
  const all = tables.flatMap((table) => collectRows(lines, table))
  return {
    lines,
    all,
    assertions: all.filter((row) => row.kind === 'assertion'),
    invariants: all.filter((row) => row.kind === 'invariant')
  }
}

const parsedOnly = (rows: readonly Row[]): ParsedRow[] =>
  rows.flatMap((row) =>
    row.id === undefined || row.statement === undefined
      ? []
      : [{ table: row.table, line: row.line, id: row.id, statement: row.statement }]
  )

const findCoverageLine = (lines: readonly string[], prefix: string): CoverageLine => {
  const index = lines.findIndex((line) => line.startsWith(prefix))
  if (index === -1) {
    throw new Error(
      `assertions-are-not-invariants: ${SPEC_PATH} carries no section 9 coverage line beginning ${JSON.stringify(prefix)}; without it there is no independently derived total to cross-check the parsed tables against, and a row dropped by the parser would pass unnoticed`
    )
  }
  return { where: `${SPEC_PATH}:${index + 1}`, text: lines[index] ?? '' }
}

const expandRange = (from: string, to: string, entry: CoverageLine): string[] => {
  const fromMatch = SERIES_PATTERN.exec(from)
  const toMatch = SERIES_PATTERN.exec(to)
  if (fromMatch === null || toMatch === null) {
    throw new Error(
      `assertions-are-not-invariants: ${entry.where} states the range ${from} to ${to}, and at least one endpoint does not read as a letter prefix followed by a number, so the range cannot be expanded`
    )
  }
  const fromPrefix = fromMatch[1] ?? ''
  const toPrefix = toMatch[1] ?? ''
  if (fromPrefix !== toPrefix) {
    throw new Error(
      `assertions-are-not-invariants: ${entry.where} states the range ${from} to ${to}, whose endpoints belong to different series, so the range cannot be expanded`
    )
  }
  const start = Number(fromMatch[2] ?? '')
  const end = Number(toMatch[2] ?? '')
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    throw new Error(
      `assertions-are-not-invariants: ${entry.where} states the range ${from} to ${to}, which does not run forwards over whole numbers, so the range cannot be expanded`
    )
  }
  const expanded: string[] = []
  for (let ordinal = start; ordinal <= end; ordinal += 1) expanded.push(`${fromPrefix}${ordinal}`)
  return expanded
}

const readCoverageIds = (entry: CoverageLine, accept: RegExp): string[] => {
  const collected: string[] = []
  for (const match of entry.text.matchAll(COVERAGE_TOKEN_PATTERN)) {
    const rangeFrom = match[1]
    const rangeTo = match[2]
    const single = match[3]
    if (rangeFrom !== undefined && rangeTo !== undefined) {
      collected.push(...expandRange(rangeFrom, rangeTo, entry))
      continue
    }
    if (single !== undefined) collected.push(single)
  }
  return collected.filter((id) => accept.test(id))
}

const needlesOf = (assertions: readonly ParsedRow[]): Needle[] => {
  const seen = new Set<string>()
  const needles: Needle[] = []
  for (const row of assertions) {
    for (const candidate of [normalise(row.statement), ...sentencesOf(row.statement)]) {
      if (candidate.length === 0 || seen.has(candidate)) continue
      seen.add(candidate)
      needles.push({ assertionId: row.id, text: candidate })
    }
  }
  return needles
}

const matchingNeedle = (needles: readonly Needle[], statement: string): Needle | undefined => {
  const normalised = normalise(statement)
  if (normalised.length === 0) return undefined
  return needles.find((needle) => normalised.includes(needle.text) || needle.text.includes(normalised))
}

const classifyRowShape = (row: Row): Verdict =>
  row.id === undefined || row.statement === undefined ? 'unclassifiable' : 'allowed'

const explainRowShape = (row: Row): string =>
  `assertions-are-not-invariants: ${SPEC_PATH}:${row.line} sits inside table ${row.table} but does not read as a bolded id cell followed by a statement cell${row.kind === 'invariant' ? ' and a traces-to cell' : ''}; the census halts rather than skipping a row it cannot classify: ${row.text}`

const classifyInvariant =
  (needles: readonly Needle[]) =>
  (row: Row): Verdict => {
    if (row.id === undefined || row.statement === undefined) return 'unclassifiable'
    return matchingNeedle(needles, row.statement) === undefined ? 'allowed' : 'forbidden'
  }

const explainInvariant =
  (needles: readonly Needle[]) =>
  (row: Row): string => {
    if (row.id === undefined || row.statement === undefined) return explainRowShape(row)
    const needle = matchingNeedle(needles, row.statement)
    if (needle === undefined) {
      return `assertions-are-not-invariants: ${row.id} at ${SPEC_PATH}:${row.line} carries no assertion statement`
    }
    return `assertions-are-not-invariants: S11 is violated at ${SPEC_PATH}:${row.line}. Invariant ${row.id} in table ${row.table} carries the statement text of assertion ${needle.assertionId}: "${needle.text}". An assertion is judged by a person and an invariant is checked by a machine, so rewriting one as the other creates a rule that claims to be checked and is not (C-11). The predicate is ${MATCHING_PREDICATE}.`
  }

const firstFailure = <T>(items: readonly T[], classify: (item: T) => Verdict, explain: (item: T) => string): string => {
  for (const item of items) {
    if (classify(item) !== 'allowed') return explain(item)
  }
  return 'no item failed this census'
}

const halts = <T>(items: readonly T[], classify: (item: T) => Verdict, explain: (item: T) => string): void => {
  try {
    census([...items], classify)
  } catch (cause) {
    assert.fail(`${firstFailure(items, classify, explain)} The census itself reported: ${String(cause)}`)
  }
}

const guardNonEmpty = (items: readonly unknown[], label: string): void => {
  assert.ok(
    items.length > 0,
    `assertions-are-not-invariants: ${SPEC_PATH} yielded no ${label}; a census over an empty list proves nothing`
  )
}

const guardSetsMatch = (
  parsed: readonly string[],
  coverage: readonly string[],
  label: string,
  entry: CoverageLine
): void => {
  const parsedSet = new Set(parsed)
  const coverageSet = new Set(coverage)
  assert.ok(
    coverageSet.size > 0,
    `assertions-are-not-invariants: ${entry.where} named no ${label} id at all; a cross-check against an empty list proves nothing`
  )
  assert.ok(
    parsedSet.size > 0,
    `assertions-are-not-invariants: the ${label} tables yielded no id; a cross-check from an empty list proves nothing`
  )
  for (const id of coverageSet) {
    assert.ok(
      parsedSet.has(id),
      `assertions-are-not-invariants: section 9 at ${entry.where} names ${label} ${id}, which this census did not parse out of the ${label} tables; a census that silently drops a row proves nothing about the row it dropped`
    )
  }
  for (const id of parsedSet) {
    assert.ok(
      coverageSet.has(id),
      `assertions-are-not-invariants: the ${label} tables carry ${id}, which section 9 at ${entry.where} does not name; the document's own coverage list and its own tables disagree`
    )
  }
}

const guardContiguousSeries = (ids: readonly string[], label: string): void => {
  const bySeries = new Map<string, number[]>()
  for (const id of ids) {
    const matched = SERIES_PATTERN.exec(id)
    if (matched === null) {
      throw new Error(
        `assertions-are-not-invariants: ${label} id ${id} does not read as a letter prefix followed by a number, so its series cannot be checked for gaps`
      )
    }
    const prefix = matched[1] ?? ''
    const ordinal = Number(matched[2] ?? '')
    bySeries.set(prefix, [...(bySeries.get(prefix) ?? []), ordinal])
  }
  assert.ok(
    bySeries.size > 0,
    `assertions-are-not-invariants: no ${label} series was derived; a contiguity check over an empty list proves nothing`
  )
  for (const [prefix, ordinals] of bySeries) {
    const sorted = [...ordinals].sort((left, right) => left - right)
    const first = sorted[0] ?? 0
    const last = sorted[sorted.length - 1] ?? 0
    assert.equal(
      new Set(sorted).size,
      sorted.length,
      `assertions-are-not-invariants: the ${label} series ${prefix} repeats an ordinal across ${prefix}${sorted.join(`, ${prefix}`)}; a repeated id makes every citation of it ambiguous`
    )
    assert.equal(
      last - first + 1,
      sorted.length,
      `assertions-are-not-invariants: the ${label} series runs ${prefix}${first} through ${prefix}${last} but carries ${sorted.length} ids, so at least one is missing; the first member of the run is derived from the document, never hardcoded`
    )
  }
}

const guardStatementLength = (rows: readonly ParsedRow[], label: string): void => {
  for (const row of rows) {
    const normalised = normalise(row.statement)
    assert.ok(
      normalised.length >= MINIMUM_STATEMENT_CHARACTERS,
      `assertions-are-not-invariants: ${label} ${row.id} at ${SPEC_PATH}:${row.line} normalises to ${normalised.length} characters ("${normalised}"), below the ${MINIMUM_STATEMENT_CHARACTERS} this census requires; a statement that short is matched by too much text to be a decidable needle`
    )
  }
}

const firstParsedAssertion = (rows: readonly ParsedRow[]): ParsedRow => {
  const first = rows[0]
  if (first === undefined) {
    throw new Error(
      `assertions-are-not-invariants: ${SPEC_PATH} yielded no parsed assertion to borrow text from; this control cannot run`
    )
  }
  return first
}

const multiSentenceAssertion = (rows: readonly ParsedRow[]): ParsedRow => {
  const found = rows.find((row) => sentencesOf(row.statement).length > 1)
  if (found === undefined) {
    throw new Error(
      `assertions-are-not-invariants: ${SPEC_PATH} yielded no assertion written as more than one sentence, so no control can show that a single borrowed sentence is caught`
    )
  }
  return found
}

const lastSentenceOf = (row: ParsedRow): string => {
  const sentences = sentencesOf(row.statement)
  const last = sentences[sentences.length - 1]
  if (last === undefined) {
    throw new Error(
      `assertions-are-not-invariants: assertion ${row.id} at ${SPEC_PATH}:${row.line} yielded no sentence, so no control can borrow one from it`
    )
  }
  return last
}

const coverageFixture = (text: string): CoverageLine => ({ where: 'a line written inside this control', text })

const DECOY_DOCUMENT: readonly string[] = [
  '# SPEC: a document shaped like the real one',
  '',
  '| | |',
  '|---|---|',
  '| **Date** | 2026-09-06 |',
  '| **Relates to** | it numbers `R-1`–`R-10`, `A8`+, `O6`+ and `S5`+ |',
  '',
  '## 3. Scope',
  '',
  '### 3.2 Out of scope, and why',
  '',
  '| Excluded | Why |',
  '|---|---|',
  '| per-criterion timestamps | a separate concern |',
  '',
  '## 4. Definitions',
  '',
  '### C-11 — an assertion is model-checked',
  '',
  '| Object | Class |',
  '|---|---|',
  '| The gate condition | **An invariant.** it names an enforcer |',
  '',
  '## 5. The recording assertions',
  '',
  '### 5.1 Presented at `SubagentStop`',
  '',
  '| ID | Assertion |',
  '|---|---|',
  '| **R-1** | Every cause this agent established is on the record. |',
  '',
  '### 5.3 Rules governing the set',
  '',
  '1. Every assertion names a category a briefing renders.',
  '2. The set is closed and short.',
  '',
  '## 6. Invariants',
  '',
  '### 6.4 Job X — a table nothing in this file names',
  '',
  '| ID | Invariant | Traces to |',
  '|---|---|---|',
  '| **S13** | For every call, an absent value is refused | `C-9` |',
  '',
  '## 7. Behavioural rules',
  '',
  '### 7.1 Schema',
  '',
  '| ID | Rule |',
  '|---|---|',
  '| **B44** | a rule that is not an invariant |',
  ''
]

test('assertions-are-not-invariants.the-tables-are-discovered-from-the-document.control.decoys-are-excluded-an-unnamed-table-is-read-and-an-empty-scan-fails-loudly', () => {
  const discovered = discoverTables(DECOY_DOCUMENT)
  assert.deepEqual(
    discovered.map((table) => table.source.label),
    ['5.1', '6.4'],
    'discovery brackets on the section headings, skips a subsection carrying no table, and picks up a table no code names'
  )
  assert.deepEqual(
    discovered.map((table) => table.source.kind),
    ['assertion', 'invariant'],
    'a table is dispositioned on its section number alone, never on its heading prose'
  )
  assert.deepEqual(
    discovered.flatMap((table) => collectRows(DECOY_DOCUMENT, table)).map((row) => row.id),
    ['R-1', 'S13']
  )
  assert.throws(() => tableSource('7.1'), /sits under section 7, for which no column count or id shape is declared/)
  assert.throws(() => tableSource('C-11'), /does not read as <section>\.<ordinal>/)

  const withoutInvariantTable = DECOY_DOCUMENT.filter((line) => !line.startsWith('### 6.4 '))
  assert.deepEqual(
    discoverTables(withoutInvariantTable).map((table) => table.source.label),
    ['5.1']
  )
  assert.throws(
    () => guardEverySectionYieldedATable(discoverTables(withoutInvariantTable)),
    /discovered no "### 6\.<n> " heading carrying a markdown table/
  )
  assert.throws(
    () => discoverTables(DECOY_DOCUMENT.filter((line) => !line.startsWith('## 7. '))),
    /carries 0 headings of the form "## 7\. "/
  )
})

test('assertions-are-not-invariants.every-row-in-the-discovered-tables-parses-into-its-declared-shape', () => {
  const { all } = readTables()
  guardNonEmpty(all, 'assertion or invariant row')
  halts(all, classifyRowShape, explainRowShape)
})

test('assertions-are-not-invariants.every-row-in-the-discovered-tables-parses-into-its-declared-shape.control.a-malformed-row-halts-the-census', () => {
  const missingTracesTo = parseRow(tableSource('6.1'), 1, '| **A8** | For every call, an absent value is refused |')
  const unbolded = parseRow(tableSource('5.1'), 2, '| R-1 | Every cause this agent established is on the record. |')
  const frontMatterShape = parseRow(
    tableSource('5.1'),
    3,
    '| **Date** | Every cause this agent established is on the record. |'
  )
  const emptyStatement = parseRow(tableSource('5.1'), 4, '| **R-1** |  |')
  const genuine = parseRow(tableSource('5.1'), 5, '| **R-1** | Every cause this agent established is on the record. |')

  for (const malformed of [missingTracesTo, unbolded, frontMatterShape, emptyStatement]) {
    assert.equal(classifyRowShape(malformed), 'unclassifiable')
    assert.throws(
      () => census([malformed], classifyRowShape),
      /census halted on an unclassifiable item/,
      `a row that does not parse into its declared shape must halt the census: ${malformed.text}`
    )
  }
  assert.equal(classifyRowShape(genuine), 'allowed')
  assert.equal(genuine.id, 'R-1')
  assert.doesNotThrow(() => census([genuine], classifyRowShape))
})

test('assertions-are-not-invariants.both-populations-are-non-empty', () => {
  const { assertions, invariants } = readTables()
  guardNonEmpty(assertions, 'assertion row')
  guardNonEmpty(invariants, 'invariant row')
  guardNonEmpty(parsedOnly(assertions), 'parsed assertion row')
  guardNonEmpty(parsedOnly(invariants), 'parsed invariant row')
  guardNonEmpty(needlesOf(parsedOnly(assertions)), 'assertion needle to search for')
})

test('assertions-are-not-invariants.the-parsed-assertion-ids-match-section-nine-in-both-directions', () => {
  const { lines, assertions } = readTables()
  guardNonEmpty(assertions, 'assertion row')
  const entry = findCoverageLine(lines, ASSERTION_COVERAGE_PREFIX)
  guardSetsMatch(
    parsedOnly(assertions).map((row) => row.id),
    readCoverageIds(entry, ASSERTION_ID_PATTERN),
    'assertion',
    entry
  )
})

test('assertions-are-not-invariants.the-parsed-invariant-ids-match-section-nine-in-both-directions', () => {
  const { lines, invariants } = readTables()
  guardNonEmpty(invariants, 'invariant row')
  const entry = findCoverageLine(lines, INVARIANT_COVERAGE_PREFIX)
  guardSetsMatch(
    parsedOnly(invariants).map((row) => row.id),
    readCoverageIds(entry, INVARIANT_ID_PATTERN),
    'invariant',
    entry
  )
})

test('assertions-are-not-invariants.the-coverage-reader-expands-a-range-and-reads-a-written-out-run-identically.control', () => {
  const ranged = coverageFixture('**Every invariant belongs to a unit.** `A8`–`A10` → U2. `S6`, `S7` → U9.')
  const writtenOut = coverageFixture('**Every invariant belongs to a unit.** `A8`, `A9`, `A10` → U2. `S6`, `S7` → U9.')
  assert.deepEqual(readCoverageIds(ranged, INVARIANT_ID_PATTERN), ['A8', 'A9', 'A10', 'S6', 'S7'])
  assert.deepEqual(
    readCoverageIds(writtenOut, INVARIANT_ID_PATTERN),
    readCoverageIds(ranged, INVARIANT_ID_PATTERN),
    'a range and the same ids written out one by one must yield the same coverage set, so the cross-check does not turn on which spelling the document uses'
  )
  const briefing = coverageFixture('`R-1`–`R-3` → the briefing')
  assert.deepEqual(readCoverageIds(briefing, ASSERTION_ID_PATTERN), ['R-1', 'R-2', 'R-3'])
  assert.deepEqual(readCoverageIds(coverageFixture('`A8`-`A10` → U2'), INVARIANT_ID_PATTERN), ['A8', 'A10'])
  assert.throws(() => readCoverageIds(coverageFixture('`A8`–`O10`'), INVARIANT_ID_PATTERN), /different series/)
  assert.throws(() => readCoverageIds(coverageFixture('`A10`–`A8`'), INVARIANT_ID_PATTERN), /does not run forwards/)
  assert.throws(
    () => expandRange('A8', 'not-an-id', coverageFixture('`A8`–`A10`')),
    /does not read as a letter prefix followed by a number/
  )
})

test('assertions-are-not-invariants.every-id-series-is-contiguous-with-no-gap-and-no-duplicate', () => {
  const { assertions, invariants } = readTables()
  guardNonEmpty(assertions, 'assertion row')
  guardNonEmpty(invariants, 'invariant row')
  guardContiguousSeries(
    parsedOnly(assertions).map((row) => row.id),
    'assertion'
  )
  guardContiguousSeries(
    parsedOnly(invariants).map((row) => row.id),
    'invariant'
  )
})

test('assertions-are-not-invariants.every-id-series-is-contiguous-with-no-gap-and-no-duplicate.control.a-gap-and-a-duplicate-each-fail-while-a-run-starting-away-from-one-passes', () => {
  assert.doesNotThrow(() => guardContiguousSeries(['A8', 'A9', 'A10'], 'invariant'))
  assert.doesNotThrow(() => guardContiguousSeries(['S5', 'S6', 'O6', 'O7'], 'invariant'))
  assert.throws(() => guardContiguousSeries(['A8', 'A10'], 'invariant'), /runs A8 through A10 but carries 2 ids/)
  assert.throws(() => guardContiguousSeries(['R-1', 'R-1', 'R-2'], 'assertion'), /repeats an ordinal/)
  assert.throws(() => guardContiguousSeries(['A8', 'not-an-id'], 'invariant'), /does not read as a letter prefix/)
})

test('assertions-are-not-invariants.every-parsed-statement-carries-non-trivial-text', () => {
  const { assertions, invariants } = readTables()
  guardNonEmpty(assertions, 'assertion row')
  guardNonEmpty(invariants, 'invariant row')
  guardStatementLength(parsedOnly(assertions), 'assertion')
  guardStatementLength(parsedOnly(invariants), 'invariant')
})

test('assertions-are-not-invariants.every-assertion-needle-is-long-enough-to-be-decidable', () => {
  const { assertions } = readTables()
  const needles = needlesOf(parsedOnly(assertions))
  guardNonEmpty(needles, 'assertion needle')
  for (const needle of needles) {
    assert.ok(
      needle.text.length >= MINIMUM_STATEMENT_CHARACTERS,
      `assertions-are-not-invariants: assertion ${needle.assertionId} yields the needle "${needle.text}" at ${needle.text.length} characters, below the ${MINIMUM_STATEMENT_CHARACTERS} this census requires; a needle that short would be found inside invariants that borrow no assertion text`
    )
  }
})

test('assertions-are-not-invariants.no-assertion-statement-appears-in-any-invariant', () => {
  const { assertions, invariants } = readTables()
  guardNonEmpty(assertions, 'assertion row')
  guardNonEmpty(invariants, 'invariant row')
  const needles = needlesOf(parsedOnly(assertions))
  guardNonEmpty(needles, 'assertion needle')
  halts(invariants, classifyInvariant(needles), explainInvariant(needles))
})

test('assertions-are-not-invariants.no-assertion-statement-appears-in-any-invariant.control.an-invariant-row-carrying-assertion-text-is-forbidden', () => {
  const { assertions } = readTables()
  const parsedAssertions = parsedOnly(assertions)
  const needles = needlesOf(parsedAssertions)
  const borrowed = firstParsedAssertion(parsedAssertions)
  const multiSentence = multiSentenceAssertion(parsedAssertions)
  const borrowedSentence = lastSentenceOf(multiSentence)

  assert.notEqual(
    borrowedSentence,
    normalise(multiSentence.statement),
    `assertions-are-not-invariants: the sentence borrowed from assertion ${multiSentence.id} is its whole statement, so this control would exercise no sentence-level matching at all`
  )

  const wholeAssertion = parseRow(tableSource('6.1'), 1, `| **A99** | ${borrowed.statement} | \`C-1\` |`)
  const embedded = parseRow(
    tableSource('6.1'),
    2,
    `| **A98** | For every gate fire, ${borrowed.statement} No write is inspected for content | \`C-8\` |`
  )
  const sentenceBorrowed = parseRow(
    tableSource('6.2'),
    3,
    `| **O99** | For every block, the text states that ${borrowedSentence} and stops there | \`C-8\` |`
  )

  for (const violation of [wholeAssertion, embedded, sentenceBorrowed]) {
    assert.equal(classifyRowShape(violation), 'allowed')
    assert.equal(classifyInvariant(needles)(violation), 'forbidden')
    assert.throws(
      () => census([violation], classifyInvariant(needles)),
      /census rejected a forbidden item/,
      `an invariant carrying assertion text must be rejected: ${violation.text}`
    )
  }

  const wholeMessage = explainInvariant(needles)(wholeAssertion)
  assert.match(wholeMessage, /S11 is violated/)
  assert.ok(
    wholeMessage.includes(`assertion ${borrowed.id}:`),
    `assertions-are-not-invariants: the S11 report for a row carrying the whole of ${borrowed.id} must name ${borrowed.id} exactly, and reads: ${wholeMessage}`
  )
  const sentenceMessage = explainInvariant(needles)(sentenceBorrowed)
  assert.ok(
    sentenceMessage.includes(`assertion ${multiSentence.id}:`),
    `assertions-are-not-invariants: the S11 report for a row carrying one sentence of ${multiSentence.id} must name ${multiSentence.id} exactly, and reads: ${sentenceMessage}`
  )
})

test('assertions-are-not-invariants.no-assertion-statement-appears-in-any-invariant.control.an-invariant-citing-only-an-assertion-id-is-allowed', () => {
  const { assertions, invariants } = readTables()
  const needles = needlesOf(parsedOnly(assertions))
  const citing = invariants.filter((row) => ASSERTION_ID_MENTION_PATTERN.test(row.statement ?? ''))
  assert.ok(
    citing.length > 0,
    `assertions-are-not-invariants: no invariant in ${SPEC_PATH} cites an assertion id, so this control pins nothing; the invariants that make a gate present the section 5 assertions are expected to name them by id`
  )
  for (const row of citing) {
    assert.equal(
      classifyInvariant(needles)(row),
      'allowed',
      `assertions-are-not-invariants: invariant ${String(row.id)} at ${SPEC_PATH}:${row.line} cites an assertion by id and must stay allowed; S11 forbids reusing assertion statement text, never referencing an assertion id`
    )
  }

  const synthetic = parseRow(
    tableSource('6.2'),
    1,
    '| **O99** | For every gate block, the block text presents `R-1` through `R-6` in full, naming none as satisfied | `C-8` |'
  )
  assert.equal(classifyInvariant(needles)(synthetic), 'allowed')
  assert.doesNotThrow(() => census([synthetic], classifyInvariant(needles)))
})

test('assertions-are-not-invariants.no-assertion-statement-appears-in-any-invariant.control.an-unparsed-row-halts-with-a-message-distinct-from-a-forbidden-one', () => {
  const { assertions } = readTables()
  const parsedAssertions = parsedOnly(assertions)
  const needles = needlesOf(parsedAssertions)
  const borrowed = firstParsedAssertion(parsedAssertions)
  const unparsed = parseRow(tableSource('6.1'), 1, '**A97** For every call, an absent value is refused')
  const forbidden = parseRow(tableSource('6.1'), 2, `| **A96** | ${borrowed.statement} | \`C-1\` |`)

  let haltedMessage = ''
  assert.throws(
    () => census([unparsed], classifyInvariant(needles)),
    (error) => {
      haltedMessage = (error as Error).message
      return true
    }
  )

  let forbiddenMessage = ''
  assert.throws(
    () => census([forbidden], classifyInvariant(needles)),
    (error) => {
      forbiddenMessage = (error as Error).message
      return true
    }
  )

  assert.match(haltedMessage, /census halted on an unclassifiable item/)
  assert.match(forbiddenMessage, /census rejected a forbidden item/)
  assert.doesNotMatch(haltedMessage, /rejected a forbidden item/)
  assert.doesNotMatch(forbiddenMessage, /halted on an unclassifiable item/)
  assert.match(explainInvariant(needles)(unparsed), /does not read as a bolded id cell/)
})
