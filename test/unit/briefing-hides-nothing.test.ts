import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { census, type Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

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
