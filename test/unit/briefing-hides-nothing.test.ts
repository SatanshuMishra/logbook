import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { renderStepBriefing } from '../../src/render/briefing.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import { testRuntime } from '../support/runtime.ts'
import { withCriterionFixture } from '../support/criterion-fixture.ts'
import { census, type Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

const rt = testRuntime()

const LONGER_THAN_ANY_FORMER_CLIP = 1000

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

const ASSERTED_ORDINAL_ROOTS = [`src${path.sep}`]

const stripTrailingSep = (root: string): string => (root.endsWith(path.sep) ? root.slice(0, -path.sep.length) : root)

const renderAssertedRootsProse = (roots: string[]): string => {
  const names = roots.map(stripTrailingSep)
  return names.reduce((prose, name, index) => {
    if (index === 0) return name
    if (index !== names.length - 1) return `${prose}, ${name}`
    return names.length === 2 ? `${prose} or ${name}` : `${prose}, or ${name}`
  }, '')
}

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

  const underAssertedRoots = population.filter((site) => ASSERTED_ORDINAL_ROOTS.some((root) => site.file.startsWith(root)))
  assert.ok(underAssertedRoots.length > 0, 'the asserted roots must read criterion.ordinal, or this assertion is vacuous')
  assert.doesNotThrow(
    () => census(underAssertedRoots, classifyOrdinalSite),
    `every read of criterion.ordinal under ${renderAssertedRootsProse(ASSERTED_ORDINAL_ROOTS)} must render a display label; any other read infers sequence from position:\n${underAssertedRoots
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
    landed: '',
    last_session: 'wrote the renderer',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
})

const stepBriefingIn = (fixtureRt: Runtime, thread: Thread): string => {
  const opened = openStore(fixtureRt, fixtureRt.cwd)
  if (!opened.ok) throw new Error(`briefing-hides-nothing fixture: the store did not open: ${opened.message}`)
  const committed = opened.value.commit([{ kind: 'thread', record: thread }], 'test: seed the hides nothing fixture thread')
  if (!committed.ok) throw new Error(`briefing-hides-nothing fixture: the thread did not commit: ${committed.detail}`)
  return renderStepBriefing(opened.value, thread, null)
}

test('briefing.a-render-is-clipped-nowhere-however-far-the-escape-expands-its-text', async () => {
  const expanding = ESCAPE_EXPANDING_CHAR.repeat(LONGER_THAN_ANY_FORMER_CLIP)
  const criterion = criterionOf({ ordinal: 1, text: expanding, check: expanding, settledness: 'proposed' })
  const riskId = rt.ulid()
  const noteId = rt.ulid()
  const thread = threadOf({
    title: expanding,
    blocked_by: expanding,
    completion_criteria: [criterion],
    spine: {
      active_goal: expanding,
      next_step: expanding,
      landed: '',
      last_session: '',
      open_risks: [{ id: riskId, scope: 's', text: expanding, refs: [], retired: false }],
      key_decisions: [],
      out_of_scope: [{ id: noteId, text: expanding }]
    }
  })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the escape-expanding fixture must itself be schema-admissible')

  await withCriterionFixture(async (fixtureRt) => {
    const briefing = stepBriefingIn(fixtureRt, thread)
    const escaped = escapeStored(expanding)
    const lines = briefing.split('\n')

    assert.ok(escaped.length > expanding.length, 'the fixture text must expand under the escape, or it proves nothing about the escaped length')
    assert.ok(lines.includes(`**Thread:** ${escaped}`), 'the briefing must render the whole title')
    assert.ok(lines.includes(`**Blocked:** ${escaped}`), 'the briefing must render the whole blockage')
    assert.ok(lines.includes(`> ${escaped}`), 'the briefing must render the whole goal and next step')
    assert.ok(lines.includes(`- risk ${riskId}: ${escaped} (bears on the whole thread)`), 'the briefing must list the whole risk text')
    assert.ok(
      lines.includes(`- criterion ${criterion.id}: c1 [open] [proposed] ${escaped}`),
      'the briefing must list the whole criterion text'
    )
    assert.ok(lines.includes(`- out-of-scope ${noteId}: ${escaped}`), 'the briefing must list the whole out-of-scope text')
    assert.equal(briefing.includes(CLIP_MARKER), false, 'the briefing must carry no clip marker')
    assert.equal(briefing.includes('**Not shown:**'), false, 'the briefing must carry no not-shown block')
  })
})

test('briefing.a-criterion-marked-done-renders-its-result-and-the-status-of-that-result', async () => {
  const criterion = criterionOf({
    ordinal: 1,
    text: 'the store defect is closed',
    done: true,
    check: 'npm test',
    result: 'the reproduction could not be run in this environment',
    result_status: 'unverified-reasoned'
  })
  const base = threadOf({ completion_criteria: [criterion] })
  const thread: Thread = { ...base, spine: { ...base.spine, next_step_records: [criterion.id] } }
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the result fixture must itself be schema-admissible')

  await withCriterionFixture(async (fixtureRt) => {
    const lines = stepBriefingIn(fixtureRt, thread).split('\n')
    assert.ok(lines.includes('Check: npm test'), `the named criterion must render its check, got:\n${lines.join('\n')}`)
    assert.ok(
      lines.includes('Result: the reproduction could not be run in this environment (unverified-reasoned)'),
      `the named criterion must render its result and the status of that result, got:\n${lines.join('\n')}`
    )
  })
})
