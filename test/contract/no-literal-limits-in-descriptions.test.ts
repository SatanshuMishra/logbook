import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import { census, type Classified } from '../support/census.ts'
import { loadSourceProgram, relativeToRoot, lineOf, sourceFileFor, forEachDescendant } from '../support/source-census.ts'
import { loadLimitsRegister } from '../support/limits-register.ts'
import { ULID_PATTERN } from '../../src/schema/ids.ts'

const RULE_TEXT =
  'a description string under src/server/tools/ is split into tokens on /[A-Za-z0-9]+/g; a token matching ' +
  'ULID_PATTERN from src/schema/ids.ts is discarded because it names an example identifier and not a number; for ' +
  'every surviving token, its leading run of ASCII digits is taken; a leading run of two or more digits is ' +
  'forbidden when its numeric value equals the value of some constant recorded in docs/registers/size-limits.json, ' +
  'and passes otherwise; a leading run of exactly one digit is exempt by construction, because the register holds ' +
  'single-digit values that would otherwise fire on ordinary prose. "A description string" means the string ' +
  'argument of a .describe(...) call and the value of a description: property. A digit run inside an ' +
  'interpolation (${...}) is not a literal and is not a violation.'

const TOOLS_DIR_PREFIX = `src${path.sep}server${path.sep}tools${path.sep}`

const TOKEN_PATTERN = /[A-Za-z0-9]+/g

const leadingDigitsOf = (token: string): string => (token.match(/^\d+/) ?? [''])[0]

type LiteralSegment = { file: string; line: number; text: string }

type DigitRunSite = { file: string; line: number; run: string }

const isDescribeCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === 'describe' &&
  node.arguments.length === 1

const isDescriptionProperty = (node: ts.Node): node is ts.PropertyAssignment =>
  ts.isPropertyAssignment(node) &&
  ((ts.isIdentifier(node.name) && node.name.text === 'description') ||
    (ts.isStringLiteral(node.name) && node.name.text === 'description'))

const literalSegmentsOf = (sourceFile: ts.SourceFile, relFile: string, expr: ts.Expression): LiteralSegment[] => {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return [{ file: relFile, line: lineOf(sourceFile, expr), text: expr.text }]
  }
  if (ts.isTemplateExpression(expr)) {
    const head: LiteralSegment = { file: relFile, line: lineOf(sourceFile, expr.head), text: expr.head.text }
    const spans = expr.templateSpans.map((span) => ({
      file: relFile,
      line: lineOf(sourceFile, span.literal),
      text: span.literal.text
    }))
    return [head, ...spans]
  }
  return []
}

const collectDescriptionSegments = (program: ts.Program, files: readonly string[]): LiteralSegment[] => {
  const segments: LiteralSegment[] = []
  for (const fileName of files) {
    const relFile = relativeToRoot(fileName)
    if (!relFile.startsWith(TOOLS_DIR_PREFIX)) continue
    const sourceFile = sourceFileFor(program, fileName)
    forEachDescendant(sourceFile, (node) => {
      if (isDescribeCall(node)) {
        const [argument] = node.arguments
        if (argument !== undefined) segments.push(...literalSegmentsOf(sourceFile, relFile, argument))
      }
      if (isDescriptionProperty(node)) {
        segments.push(...literalSegmentsOf(sourceFile, relFile, node.initializer))
      }
    })
  }
  return segments
}

const digitRunSitesOf = (segments: readonly LiteralSegment[]): DigitRunSite[] =>
  segments.flatMap((segment) =>
    [...segment.text.matchAll(TOKEN_PATTERN)]
      .map((match) => match[0])
      .filter((token) => !ULID_PATTERN.test(token))
      .map((token) => leadingDigitsOf(token))
      .filter((run) => run.length >= 2)
      .map((run) => ({ file: segment.file, line: segment.line, run }))
  )

const registeredValues = (): ReadonlySet<number> =>
  new Set(
    loadLimitsRegister()
      .map((row) => row.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  )

const classifyDigitRun = (
  site: DigitRunSite,
  forbidden: ReadonlySet<number>
): Classified<DigitRunSite>['verdict'] | 'unclassifiable' => (forbidden.has(Number(site.run)) ? 'forbidden' : 'allowed')

const describeDigitRunFailure = (forbidden: ReadonlySet<number>) => (site: DigitRunSite): string =>
  `no-literal-limits-in-descriptions: ${site.file}:${site.line} carries the literal digit run "${site.run}", which equals a value recorded in docs/registers/size-limits.json (forbidden values: ${[...forbidden].sort((a, b) => a - b).join(', ')}); ${RULE_TEXT}`

const firstFailure = <T,>(
  items: readonly T[],
  classify: (item: T) => Classified<T>['verdict'] | 'unclassifiable',
  describe: (item: T) => string
): string => {
  for (const item of items) {
    if (classify(item) !== 'allowed') return describe(item)
  }
  return 'no item failed this census'
}

test('contract.no-literal-limits-in-descriptions.population-is-non-empty', () => {
  const { program, productionFiles } = loadSourceProgram()
  const segments = collectDescriptionSegments(program, productionFiles)
  assert.ok(
    segments.length > 0,
    `no-literal-limits-in-descriptions: ${RULE_TEXT}; swept 0 description strings under src/server/tools/; a census over an empty population proves nothing`
  )
})

test('contract.no-literal-limits-in-descriptions.forbidden-set-is-non-empty', () => {
  const forbidden = registeredValues()
  assert.ok(
    forbidden.size > 0,
    'no-literal-limits-in-descriptions: docs/registers/size-limits.json produced 0 forbidden values; a census that ' +
      'compares a real population against an empty forbidden set can never fail and proves nothing'
  )
})

test('contract.no-literal-limits-in-descriptions.every-digit-run-matches-no-registered-value', () => {
  const { program, productionFiles } = loadSourceProgram()
  const segments = collectDescriptionSegments(program, productionFiles)
  const sites = digitRunSitesOf(segments)
  const forbidden = registeredValues()
  const classify = (site: DigitRunSite) => classifyDigitRun(site, forbidden)
  assert.doesNotThrow(() => census(sites, classify), firstFailure(sites, classify, describeDigitRunFailure(forbidden)))
})

test('contract.no-literal-limits-in-descriptions.control.a-run-matching-a-registered-value-halts', () => {
  const forbidden = new Set([8000])
  const violating: DigitRunSite = { file: 'src/server/tools/example.ts', line: 1, run: '8000' }
  assert.equal(classifyDigitRun(violating, forbidden), 'forbidden')
  assert.throws(() => census([violating], (site) => classifyDigitRun(site, forbidden)))
})

test('contract.no-literal-limits-in-descriptions.control.a-run-matching-no-registered-value-passes', () => {
  const forbidden = new Set([8000])
  const clean: DigitRunSite = { file: 'src/server/tools/example.ts', line: 1, run: '436' }
  assert.equal(classifyDigitRun(clean, forbidden), 'allowed')
  assert.doesNotThrow(() => census([clean], (site) => classifyDigitRun(site, forbidden)))
})

test('contract.no-literal-limits-in-descriptions.control.digits-inside-an-interpolation-are-excluded', () => {
  const source = 'x.describe(`the value is ${8000} but 436 is fine`)'
  const sourceFile = ts.createSourceFile('synthetic.ts', source, ts.ScriptTarget.Latest, true)
  const segments: LiteralSegment[] = []
  forEachDescendant(sourceFile, (node) => {
    if (isDescribeCall(node)) {
      const [argument] = node.arguments
      if (argument !== undefined) segments.push(...literalSegmentsOf(sourceFile, 'synthetic.ts', argument))
    }
  })
  const runs = digitRunSitesOf(segments).map((site) => site.run)
  assert.deepEqual(
    runs,
    ['436'],
    'expected the digit run inside ${...} to be excluded by construction and only the literal "436" to be swept'
  )
})

test('contract.no-literal-limits-in-descriptions.control.the-matcher-catches-restated-limits-and-lets-others-through', () => {
  const source =
    'x.describe(`up to 8000chars is the limit, and up to 64KB fits, and up to 25 items or up to 26 rows are ' +
    'allowed, timestamps use ISO-8601, and results read like 436 tests, 0 fail, exit 0`)'
  const sourceFile = ts.createSourceFile('synthetic.ts', source, ts.ScriptTarget.Latest, true)
  const segments: LiteralSegment[] = []
  forEachDescendant(sourceFile, (node) => {
    if (isDescribeCall(node)) {
      const [argument] = node.arguments
      if (argument !== undefined) segments.push(...literalSegmentsOf(sourceFile, 'synthetic.ts', argument))
    }
  })
  const sites = digitRunSitesOf(segments)
  const forbidden = new Set([8000, 64, 25, 26])
  assert.deepEqual(
    sites.map((site) => site.run),
    ['8000', '64', '25', '26', '8601', '436'],
    'expected the tokenizer to recover "8000" out of "8000chars", "64" out of the unit-suffixed "64KB", the bare ' +
      'runs "25" and "26", "8601" out of "ISO-8601", and "436", while dropping the single-digit "0"s by construction'
  )
  assert.deepEqual(
    sites.map((site) => classifyDigitRun(site, forbidden)),
    ['forbidden', 'forbidden', 'forbidden', 'forbidden', 'allowed', 'allowed'],
    'expected 8000, 64 (via the unit-suffixed 64KB), 25 and 26 to be caught as restatements of registered limits, ' +
      'and 8601 (an ISO-8601 restatement) and 436 (an exit-code example) to pass because neither is registered'
  )
})
