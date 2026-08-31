import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { renderBriefingWithPasses, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES } from '../../src/render/clip.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
import * as caps from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'
import { census, type Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

type SliceSite = { file: string; line: number; expression: string; discardsElements: boolean }

const discardsSlicedElements = (call: ts.CallExpression): boolean => {
  const access = call.parent
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== 'map') return false
  const mapCall = access.parent
  if (!ts.isCallExpression(mapCall)) return false
  const callback = mapCall.arguments[0]
  if (callback === undefined || !ts.isArrowFunction(callback)) return false
  return callback.parameters.length === 0
}

const collectSliceSites = (sourceFile: ts.SourceFile): SliceSite[] => {
  const found: SliceSite[] = []
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    const callee = node.expression
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'slice') return
    found.push({
      file: relativeToRoot(sourceFile.fileName),
      line: lineOf(sourceFile, node),
      expression: node.getText(sourceFile),
      discardsElements: discardsSlicedElements(node)
    })
  })
  return found
}

const classifySliceSite = (site: SliceSite): Classified<SliceSite>['verdict'] | 'unclassifiable' =>
  site.discardsElements ? 'allowed' : 'forbidden'

test('briefing.no-display-time-item-cap-remains-in-the-briefing-renderer', () => {
  const { program } = loadSourceProgram()
  const briefingPath = path.join(REBUILD_ROOT, 'src', 'render', 'briefing.ts')
  const sites = collectSliceSites(sourceFileFor(program, briefingPath))

  assert.ok(
    sites.length > 0,
    'the briefing renderer must contain at least one slice call, or this census is running over an empty population'
  )
  assert.doesNotThrow(
    () => census(sites, classifySliceSite),
    `every slice in the briefing renderer must discard the elements it selects, which is the heading idiom; a slice that keeps them is a display-time item cap:\n${sites
      .filter((site) => !site.discardsElements)
      .map((site) => `${site.file}:${site.line} ${site.expression}`)
      .join('\n')}`
  )
})

test('briefing.no-display-time-item-cap-remains-in-the-briefing-renderer.control.a-slice-that-keeps-its-elements-is-forbidden', () => {
  const synthetic: SliceSite[] = [
    { file: 'src/render/briefing.ts', line: 1, expression: 'items.slice(0, 10)', discardsElements: false }
  ]
  assert.throws(() => census(synthetic, classifySliceSite))
})

const ORDINAL_FIELD = 'ordinal'
const ORDINAL_ROOTS = ['src', 'hooks', 'bin', 'scripts', 'test']
const NON_PROGRAM_SOURCE_EXTENSIONS = ['.mjs', '.cjs', '.js']

type OrdinalUse = 'display-label' | 'field-copy' | 'test-observation' | 'position-comparison' | 'unknown'

type OrdinalSite = { file: string; line: number; expression: string; use: OrdinalUse }

const insideTemplateExpression = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isTemplateExpression(current)) return true
    current = current.parent
  }
  return false
}

const POSITION_COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken
])

const isPositionComparison = (node: ts.Node): boolean => {
  const parent = node.parent
  if (!ts.isBinaryExpression(parent)) return false
  return POSITION_COMPARISON_OPERATORS.has(parent.operatorToken.kind)
}

const isFieldCopy = (node: ts.Node): boolean => {
  const parent = node.parent
  if (!ts.isPropertyAssignment(parent) || parent.initializer !== node) return false
  const name = parent.name
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === ORDINAL_FIELD
}

const isTestObservation = (file: string): boolean => file.startsWith(`test${path.sep}`)

const useOf = (node: ts.Node, file: string): OrdinalUse => {
  if (insideTemplateExpression(node)) return 'display-label'
  if (isFieldCopy(node)) return 'field-copy'
  if (isTestObservation(file)) return 'test-observation'
  if (isPositionComparison(node)) return 'position-comparison'
  return 'unknown'
}

const collectOrdinalSites = (sourceFile: ts.SourceFile): OrdinalSite[] => {
  const file = relativeToRoot(sourceFile.fileName)
  const found: OrdinalSite[] = []
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== ORDINAL_FIELD) return
    found.push({ file, line: lineOf(sourceFile, node), expression: node.getText(sourceFile), use: useOf(node, file) })
  })
  return found
}

const classifyOrdinalSite = (site: OrdinalSite): Classified<OrdinalSite>['verdict'] | 'unclassifiable' => {
  if (site.use === 'display-label' || site.use === 'field-copy' || site.use === 'test-observation') return 'allowed'
  if (site.use === 'position-comparison') return 'forbidden'
  return 'unclassifiable'
}

const listSourceFilesUnder = (root: string): string[] => {
  const absoluteRoot = path.join(REBUILD_ROOT, root)
  if (!existsSync(absoluteRoot)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (NON_PROGRAM_SOURCE_EXTENSIONS.includes(path.extname(entry.name))) out.push(full)
    }
  }
  walk(absoluteRoot)
  return out
}

const nonProgramOrdinalSites = (): OrdinalSite[] =>
  ORDINAL_ROOTS.flatMap(listSourceFilesUnder).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        line.includes(`.${ORDINAL_FIELD}`)
          ? [{ file: relativeToRoot(file), line: index + 1, expression: line.trim(), use: 'unknown' as OrdinalUse }]
          : []
      )
  )

const UNASSERTED_ORDINAL_ROOT = `src${path.sep}render${path.sep}`

test('briefing.criterion-ordinal-is-read-only-to-render-a-display-label', (t) => {
  const { program, productionFiles, testFiles } = loadSourceProgram()
  const everyRead = [...productionFiles, ...testFiles]
    .map((file) => sourceFileFor(program, file))
    .flatMap(collectOrdinalSites)
  const outsideTheProgram = nonProgramOrdinalSites()
  const population = [...everyRead, ...outsideTheProgram]

  assert.ok(
    population.length > 0,
    'the tree must read criterion.ordinal at least once, or this census is running over an empty population'
  )
  for (const site of population) t.diagnostic(`${site.file}:${site.line} [${site.use}] ${site.expression}`)

  const forbidden = population.filter((site) => classifyOrdinalSite(site) !== 'allowed')
  for (const site of forbidden) {
    t.diagnostic(`unasserted here, owned elsewhere: ${site.file}:${site.line} ${site.expression}`)
  }

  const underRender = population.filter((site) => site.file.startsWith(UNASSERTED_ORDINAL_ROOT))
  assert.ok(underRender.length > 0, 'the render modules must read criterion.ordinal, or this assertion is vacuous')
  assert.doesNotThrow(
    () => census(underRender, classifyOrdinalSite),
    `every read of criterion.ordinal under src/render must render a display label; any other read infers sequence from position:\n${underRender
      .filter((site) => classifyOrdinalSite(site) !== 'allowed')
      .map((site) => `${site.file}:${site.line} ${site.expression}`)
      .join('\n')}`
  )
})

test('briefing.criterion-ordinal-is-read-only-to-render-a-display-label.control.a-read-outside-a-label-is-forbidden', () => {
  const comparison: OrdinalSite[] = [
    { file: 'src/render/briefing.ts', line: 1, expression: 'candidate.ordinal < best.ordinal', use: 'position-comparison' }
  ]
  assert.throws(() => census(comparison, classifyOrdinalSite))
  const unknown: OrdinalSite[] = [
    { file: 'src/render/briefing.ts', line: 1, expression: 'sortBy(candidate.ordinal)', use: 'unknown' }
  ]
  assert.throws(() => census(unknown, classifyOrdinalSite))
})

const ESCAPE_EXPANDING_CHAR = '#'

const criterionOf = (overrides: Partial<Criterion> = {}): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'a criterion',
  done: false,
  kind: 'planned',
  struck_by: null,
  ...overrides
})

const threadOf = (overrides: Partial<Thread> = {}): Thread => ({
  id: rt.ulid(),
  slug: 'hides-nothing-fixture',
  title: 'Hides Nothing Fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the renderer',
    next_step: 'write the tests',
    last_session: 'wrote the renderer',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
})

test('briefing.a-render-that-fits-its-budget-is-clipped-nowhere', () => {
  const predecessor = threadOf({ title: ESCAPE_EXPANDING_CHAR.repeat(caps.THREAD_TITLE_MAX), status: 'done' })
  const thread = threadOf({
    predecessor_id: predecessor.id,
    completion_criteria: [
      criterionOf({ ordinal: 1, text: ESCAPE_EXPANDING_CHAR.repeat(caps.CRITERION_TEXT_MAX) })
    ],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [{ id: rt.ulid(), scope: 's', text: ESCAPE_EXPANDING_CHAR.repeat(caps.RISK_TEXT_MAX), refs: [] }],
      key_decisions: [],
      out_of_scope: []
    }
  })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the escape-expanding fixture must itself be schema-admissible')

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, predecessor)

  assert.equal(render.withinBudget, true, 'this fixture must fit its budget, or it says nothing about a render that fits')
  const criterionText = thread.completion_criteria[0]?.text
  const riskText = thread.spine.open_risks[0]?.text
  if (criterionText === undefined || riskText === undefined) {
    throw new Error('the escape-expanding fixture must carry one criterion and one risk, or there is no full render to check')
  }
  assert.ok(
    render.briefing.includes(escapeStored(criterionText)),
    'a briefing that fits its budget must render the whole criterion text, however far the escape expands it'
  )
  assert.ok(
    render.briefing.includes(escapeStored(riskText)),
    'a briefing that fits its budget must render the whole risk text, however far the escape expands it'
  )
  assert.ok(
    render.briefing.includes(escapeStored(predecessor.title)),
    'a briefing that fits its budget must render the whole predecessor title, which no fixed limit may shorten'
  )
  assert.equal(
    render.briefing.includes(CLIP_MARKER),
    false,
    'a briefing that fits its budget must carry no clip marker'
  )
  assert.equal(
    render.briefing.includes('**Not shown:**'),
    false,
    'a briefing that fits its budget must carry no not-shown block'
  )
  assert.equal(render.passes, 1, 'a briefing that fits its budget must never enter the clip search')
})

const SHORTENING_FIXTURE_CRITERION_COUNT = 100
const SHORTENING_FIXTURE_CRITERION_TEXT_LENGTH = 300

const CRITERION_TEXT_PATTERN = /^- c\d+ \[(?:open|done|struck)\]: (.*) \(id [0-9A-HJKMNP-TV-Z]{26}\)$/
const RISK_TEXT_PATTERN = /^- [0-9A-HJKMNP-TV-Z]{26} (.*)$/
const SUCCEEDS_TITLE_PATTERN = /^- succeeds: (.*) \([^)]*\)$/

const SHORTENABLE_VALUE_PATTERNS = [CRITERION_TEXT_PATTERN, RISK_TEXT_PATTERN, SUCCEEDS_TITLE_PATTERN]

const storedValueOf = (line: string): string | null => {
  for (const pattern of SHORTENABLE_VALUE_PATTERNS) {
    const match = pattern.exec(line)
    if (match !== null && match[1] !== undefined) return match[1]
  }
  return null
}

test('briefing.every-shortened-value-carries-the-marker-inside-its-own-limit', () => {
  const criteria: Criterion[] = Array.from({ length: SHORTENING_FIXTURE_CRITERION_COUNT }, (_, index) =>
    criterionOf({ ordinal: index + 1, text: 'x'.repeat(SHORTENING_FIXTURE_CRITERION_TEXT_LENGTH) })
  )
  const predecessor = threadOf({
    slug: 'a'.repeat(caps.THREAD_SLUG_MAX),
    title: 'p'.repeat(caps.THREAD_TITLE_MAX),
    status: 'done'
  })
  const thread = threadOf({ predecessor_id: predecessor.id, completion_criteria: criteria })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the shortening fixture must itself be schema-admissible')
  assert.equal(ThreadRecord.parse(predecessor).ok, true, 'the predecessor fixture must itself be schema-admissible')

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, predecessor)
  assert.ok(render.passes > 1, 'this fixture must enter the clip search, or nothing was shortened')
  assert.equal(render.withinBudget, true, 'the clip search must land this fixture inside its budget')

  const marked = render.briefing
    .split('\n')
    .filter((line) => line.includes(CLIP_MARKER))
    .filter((line) => !line.startsWith('- some text on this briefing was shortened'))
  assert.ok(marked.length > 0, 'the clip search must have shortened at least one value')

  for (const line of marked) {
    assert.equal(line.split(CLIP_MARKER).length - 1, 1, `the marker must appear once on a shortened line, got: ${line}`)
    const value = storedValueOf(line)
    assert.notEqual(value, null, `a line carrying the marker must be a value line this test can read, got: ${line}`)
    assert.ok((value as string).endsWith(CLIP_MARKER), `a shortened value must end with the marker, got: ${value as string}`)
    assert.ok(
      (value as string).length > CLIP_MARKER_GRAPHEMES,
      `a shortened value must keep some of its own text beside the marker, got: ${value as string}`
    )
  }

  assert.ok(
    render.briefing.includes(
      '- some text on this briefing was shortened to fit the character budget; every shortened value ends with ...[shortened]'
    ),
    'the not-shown block must say that text was shortened'
  )
  assert.ok(
    render.briefing.includes(`ends with ${CLIP_MARKER}`),
    'the not-shown bullet must name the same marker the shortened values carry'
  )
  assert.ok(
    render.briefing.includes(`See logbook://thread/${thread.id} for the complete record.`),
    'a shortened render must carry the address that resolves to the complete record'
  )
})
