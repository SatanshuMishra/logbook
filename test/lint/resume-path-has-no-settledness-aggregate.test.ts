import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import {
  HELPER_NAME,
  SEED_FILE,
  SETTLEDNESS_FIELD,
  type SettlednessSite,
  classifySettlednessSite,
  collectSettlednessSites,
  halt,
  resumePathCensus
} from '../support/settledness-census.ts'
import { REBUILD_ROOT } from '../support/source-census.ts'

const CLOSURE_MUST_REACH = [SEED_FILE, 'src/schema/thread.ts'] as const

const CLOSURE_MUST_NOT_REACH = [
  'src/render/roster.ts',
  'src/server/resource-render.ts',
  'src/domain/done-gate.ts',
  'src/domain/criteria.ts'
] as const

const CENSUS_FORBIDDEN_PREFIX = 'census rejected a forbidden item:'
const CENSUS_UNCLASSIFIABLE_PREFIX = 'census halted on an unclassifiable item:'

const raisedBy =
  (prefix: string) =>
  (error: unknown): boolean =>
    error instanceof Error && error.message.startsWith(prefix)

const describeSite = (site: SettlednessSite): string =>
  `${site.file}:${site.line} [${site.mechanism}] [${site.use}] ${site.expression}`

const SYNTHETIC_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  allowImportingTsExtensions: true,
  noEmit: true
}

const SYNTHETIC_THREAD_SOURCE = [
  "export type Settledness = 'confirmed' | 'proposed' | 'unsettled'",
  '',
  'export type Criterion = { id: string; settledness?: Settledness | undefined }',
  '',
  "export const criterionSettledness = (criterion: Criterion): Settledness => criterion.settledness ?? 'proposed'",
  ''
].join('\n')

type VirtualModule = { directory: string; modulePath: string; threadPath: string }

const virtualModule = (name: string): VirtualModule => {
  const directory = path.join(REBUILD_ROOT, 'test', `resume-path-settledness-${name}-virtual`)
  return {
    directory,
    modulePath: path.join(directory, `${name}.ts`),
    threadPath: path.join(directory, 'thread.ts')
  }
}

const AGGREGATE = virtualModule('aggregate')
const INCLUSION = virtualModule('inclusion')
const POINT_FREE = virtualModule('point-free')
const LOOP_ACCUMULATOR = virtualModule('loop-accumulator')
const LOOPING_CALLBACK = virtualModule('looping-callback')
const RECURSIVE_TALLY = virtualModule('recursive-tally')
const DESTRUCTURED_REDUCTION = virtualModule('destructured-reduction')
const THREAD_LEVEL_SUMMARY = virtualModule('thread-level-summary')
const INLINED_RENDER = virtualModule('inlined-render')

const FORBIDDEN_AGGREGATE_TEXT = "criteria.filter((c) => criterionSettledness(c) === 'confirmed').length"

const AGGREGATE_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion } from './thread.ts'",
  '',
  'export const renderSettledSummary = (criteria: readonly Criterion[]): string =>',
  `  \`- confirmed so far: \${${FORBIDDEN_AGGREGATE_TEXT}}\``,
  ''
].join('\n')

const INCLUSION_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion } from './thread.ts'",
  '',
  'const renderSettledByLine = (criterion: Criterion): string => `  - settled by: ${criterion.id}`',
  '',
  'export const renderCriterionBlock = (criterion: Criterion): string =>',
  '  [',
  '    `- ${criterion.id}`,',
  "    ...[criterion].filter((entry) => criterionSettledness(entry) === 'confirmed').map((entry) => renderSettledByLine(entry)),",
  "    ...[criterion].filter((entry) => entry.settledness === 'confirmed').map((entry) => renderSettledByLine(entry))",
  "  ].join('\\n')",
  ''
].join('\n')

const POINT_FREE_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion } from './thread.ts'",
  '',
  'export const renderConfirmedTotal = (criteria: readonly Criterion[]): string =>',
  "  `- confirmed so far: ${criteria.map(criterionSettledness).filter((value) => value === 'confirmed').length}`",
  ''
].join('\n')

const LOOP_ACCUMULATOR_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion } from './thread.ts'",
  '',
  'export const confirmedTotal = (criteria: readonly Criterion[]): number => {',
  '  let confirmed = 0',
  '  for (const criterion of criteria) {',
  "    confirmed += criterionSettledness(criterion) === 'confirmed' ? 1 : 0",
  '  }',
  '  return confirmed',
  '}',
  ''
].join('\n')

const LOOPING_CALLBACK_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion } from './thread.ts'",
  '',
  'export const confirmedTallies = (criteria: readonly Criterion[]): number[] =>',
  '  [criteria].map((entries) => {',
  '    let tally = 0',
  '    for (const entry of entries) {',
  "      if (criterionSettledness(entry) === 'confirmed') tally += 1",
  '    }',
  '    return tally',
  '  })',
  ''
].join('\n')

const RECURSIVE_TALLY_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion } from './thread.ts'",
  '',
  'export const confirmedTally = (criteria: readonly Criterion[]): number =>',
  '  criteria.length === 0',
  '    ? 0',
  "    : (criterionSettledness(criteria[0] as Criterion) === 'confirmed' ? 1 : 0) + confirmedTally(criteria.slice(1))",
  ''
].join('\n')

const DESTRUCTURED_REDUCTION_MODULE_SOURCE = [
  "import { type Criterion } from './thread.ts'",
  '',
  'export const anyConfirmed = (criteria: readonly Criterion[]): boolean =>',
  '  criteria.some((item) => {',
  '    const { settledness } = item',
  "    return settledness === 'confirmed'",
  '  })',
  ''
].join('\n')

const THREAD_LEVEL_SUMMARY_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion } from './thread.ts'",
  '',
  "const NOT_RECORDED = 'not recorded'",
  '',
  'export const renderOverallSettledness = (criteria: readonly Criterion[]): string =>',
  '  criteria.length === 0',
  '    ? NOT_RECORDED',
  '    : `overall: ${criterionSettledness(criteria[0] as Criterion)}`',
  ''
].join('\n')

const INLINED_RENDER_MODULE_SOURCE = [
  "import { criterionSettledness, type Criterion, type Settledness } from './thread.ts'",
  '',
  'const renderCriterionLine = (criterion: Criterion, settledness: Settledness): string =>',
  '  `- ${criterion.id} [${settledness}]`',
  '',
  'export const renderCriterionLines = (criteria: readonly Criterion[]): string[] => [',
  '  ...criteria.map((entry) => renderCriterionLine(entry, criterionSettledness(entry)))',
  ']',
  ''
].join('\n')

const syntheticSites = (virtual: VirtualModule, moduleSource: string): SettlednessSite[] => {
  const files = new Map([
    [virtual.modulePath, moduleSource],
    [virtual.threadPath, SYNTHETIC_THREAD_SOURCE]
  ])
  const base = ts.createCompilerHost(SYNTHETIC_OPTIONS, true)
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (fileName) => files.has(fileName) || base.fileExists(fileName),
    directoryExists: (directoryName) =>
      directoryName === virtual.directory || (base.directoryExists?.(directoryName) ?? false),
    readFile: (fileName) => files.get(fileName) ?? base.readFile(fileName),
    getSourceFile: (fileName, options, onError, shouldCreate) => {
      const contents = files.get(fileName)
      if (contents === undefined) return base.getSourceFile(fileName, options, onError, shouldCreate)
      return ts.createSourceFile(fileName, contents, options, true)
    }
  }
  const program = ts.createProgram({ rootNames: [virtual.modulePath], options: SYNTHETIC_OPTIONS, host })
  const sourceFile = program.getSourceFile(virtual.modulePath)
  if (sourceFile === undefined) {
    return halt(`the in-memory module ${virtual.modulePath} did not enter the program, so this control asserts nothing`)
  }
  const diagnostics = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)]
  if (diagnostics.length > 0) {
    const rendered = diagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')
    return halt(
      `the in-memory module ${virtual.modulePath} did not compile, so its symbols never resolved and this control asserts nothing: ${rendered}`
    )
  }
  return collectSettlednessSites(program.getTypeChecker(), sourceFile, virtual.modulePath, ['./thread.ts'])
}

const escapeIsRed = (
  sites: SettlednessSite[],
  virtual: VirtualModule,
  prefix: string,
  why: string
): void => {
  assert.throws(
    () => census(sites, classifySettlednessSite),
    (error: unknown) => {
      assert.ok(error instanceof Error, `${why}; the census must halt by throwing an Error`)
      assert.ok(
        raisedBy(prefix)(error),
        `${why}; the census must raise ${prefix} on it, and the message read: ${error.message}`
      )
      assert.ok(
        error.message.includes(virtual.modulePath),
        `${why}; the halt must name the module it stopped on, and the message read: ${error.message}`
      )
      return true
    },
    why
  )
}

test('contract.resume-path-has-no-settledness-aggregate.no-callee-of-the-briefing-renderer-reduces-over-settledness', () => {
  const { valueClosure, everyEdgeClosure, helperModule, population } = resumePathCensus()

  for (const required of CLOSURE_MUST_REACH) {
    assert.ok(
      valueClosure.includes(required),
      `resume-path settledness census: the forward value-edge closure of ${SEED_FILE} did not reach ${required}, so this census says nothing about a file the resume render path runs; derived ${valueClosure.join(', ')}`
    )
  }

  for (const excluded of CLOSURE_MUST_NOT_REACH) {
    assert.equal(
      valueClosure.includes(excluded),
      false,
      `resume-path settledness census: ${excluded} entered the forward closure of ${SEED_FILE}, and it is not a callee of the briefing renderer, so the closure has collapsed onto files the resume path never runs and the census would judge aggregates that are legitimate on their own paths; derived ${valueClosure.join(', ')}`
    )
  }

  assert.ok(
    everyEdgeClosure.length > valueClosure.length,
    `resume-path settledness census: closing over every import edge derived ${everyEdgeClosure.length} files and closing over value edges alone derived ${valueClosure.length}, so the type-only edge filter removed nothing and this closure is not proven to be the value-edge closure it claims; value closure ${valueClosure.join(', ')}`
  )

  assert.ok(
    population.length > 0,
    `resume-path settledness census: the forward closure of ${SEED_FILE} yielded no settledness read at all; a census over an empty population proves nothing; closure ${valueClosure.join(', ')}`
  )

  const seedHelperCalls = population.filter((site) => site.file === SEED_FILE && site.mechanism === 'helper-call')
  assert.ok(
    seedHelperCalls.length > 0,
    `resume-path settledness census: ${SEED_FILE} yielded no call to ${HELPER_NAME} resolved through the checker against ${helperModule}, so the symbol resolver is dead and a rename would empty this census into a false green; sites read ${population.map(describeSite).join(' | ')}`
  )

  assert.doesNotThrow(
    () => census(population, classifySettlednessSite),
    `resume-path settledness census: every settledness read reachable from ${SEED_FILE} through value imports must be a per-criterion read or the single-criterion inclusion idiom, never a reduction over the field and never a count of it; sites read ${population.map(describeSite).join(' | ')}`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.a-settledness-count-turns-the-census-red', () => {
  const sites = syntheticSites(AGGREGATE, AGGREGATE_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[`${HELPER_NAME}(c)`, 'helper-call', 'count']],
    `the synthetic module must expose exactly one settledness read, collected through the checker-resolved helper call and classified as a count; sites read ${sites.map(describeSite).join(' | ')}`
  )

  escapeIsRed(
    sites,
    AGGREGATE,
    CENSUS_FORBIDDEN_PREFIX,
    `a module counting how many criteria are confirmed with ${FORBIDDEN_AGGREGATE_TEXT} must turn this census red, otherwise the census is collecting sites without judging them`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.the-single-criterion-inclusion-idiom-stays-allowed', () => {
  const sites = syntheticSites(INCLUSION, INCLUSION_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [
      [`${HELPER_NAME}(entry)`, 'helper-call', 'conditional-inclusion'],
      [`entry.${SETTLEDNESS_FIELD}`, 'property-access', 'conditional-inclusion']
    ],
    `the synthetic module must expose the inclusion idiom twice, once through the helper and once through a direct field read, so both collection mechanisms are proven alive; sites read ${sites.map(describeSite).join(' | ')}`
  )

  assert.doesNotThrow(
    () => census(sites, classifySettlednessSite),
    `filtering a one-element array holding the criterion being rendered is how this codebase includes a line conditionally, and the census must not call it an aggregate, otherwise it turns shipped-correct per-criterion rendering red; sites read ${sites.map(describeSite).join(' | ')}`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.a-point-free-helper-reference-turns-the-census-red', () => {
  const sites = syntheticSites(POINT_FREE, POINT_FREE_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[HELPER_NAME, 'helper-reference', 'count']],
    `handing ${HELPER_NAME} to an array method by name reads settledness once per criterion without ever writing a call, and collection must see it as a point-free reference rather than skipping it; sites read ${sites.map(describeSite).join(' | ')}`
  )

  escapeIsRed(
    sites,
    POINT_FREE,
    CENSUS_FORBIDDEN_PREFIX,
    `passing ${HELPER_NAME} as a named callback is this codebase's house style, so a count written that way must turn this census red exactly as the spelled-out call does`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.a-loop-accumulating-settledness-turns-the-census-red', () => {
  const sites = syntheticSites(LOOP_ACCUMULATOR, LOOP_ACCUMULATOR_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[`${HELPER_NAME}(criterion)`, 'helper-call', 'arithmetic-read']],
    `a settledness read whose value is added into a running total is an aggregate however the loop is written, and the census must say so rather than assuming a per-criterion read; sites read ${sites.map(describeSite).join(' | ')}`
  )

  escapeIsRed(
    sites,
    LOOP_ACCUMULATOR,
    CENSUS_UNCLASSIFIABLE_PREFIX,
    `counting confirmed criteria by hand in a for-of loop uses no array method at all, and a census that only recognises array methods would ship it green`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.a-loop-inside-a-single-element-callback-turns-the-census-red', () => {
  const sites = syntheticSites(LOOPING_CALLBACK, LOOPING_CALLBACK_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[`${HELPER_NAME}(entry)`, 'helper-call', 'iterated-read']],
    `wrapping a whole criteria list in a one-element array does not make the read per-criterion, and the inclusion carve-out must refuse a callback that iterates; sites read ${sites.map(describeSite).join(' | ')}`
  )

  escapeIsRed(
    sites,
    LOOPING_CALLBACK,
    CENSUS_UNCLASSIFIABLE_PREFIX,
    `the single-element inclusion idiom is a carve-out for the criterion being rendered, and a loop hidden inside its callback must not inherit that carve-out`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.a-recursive-tally-of-settledness-turns-the-census-red', () => {
  const sites = syntheticSites(RECURSIVE_TALLY, RECURSIVE_TALLY_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[`${HELPER_NAME}(criteria[0] as Criterion)`, 'helper-call', 'recursive-read']],
    `a function that calls itself walks the whole list, so a settledness read inside it is never demonstrably about one criterion; sites read ${sites.map(describeSite).join(' | ')}`
  )

  escapeIsRed(
    sites,
    RECURSIVE_TALLY,
    CENSUS_UNCLASSIFIABLE_PREFIX,
    `a recursive count reaches every criterion without any loop and without any array method, and a census that assumes per-criterion by default would ship it green`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.a-destructured-settledness-field-turns-the-census-red', () => {
  const sites = syntheticSites(DESTRUCTURED_REDUCTION, DESTRUCTURED_REDUCTION_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[SETTLEDNESS_FIELD, 'destructured-field', 'reduction']],
    `destructuring names the field without writing a property access, and collection must admit that shape or the reduction around it never enters the population; sites read ${sites.map(describeSite).join(' | ')}`
  )

  escapeIsRed(
    sites,
    DESTRUCTURED_REDUCTION,
    CENSUS_FORBIDDEN_PREFIX,
    `a reduction over settledness must turn this census red whether the field is reached by a property access or by a binding pattern`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.a-thread-level-settledness-summary-turns-the-census-red', () => {
  const sites = syntheticSites(THREAD_LEVEL_SUMMARY, THREAD_LEVEL_SUMMARY_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[`${HELPER_NAME}(criteria[0] as Criterion)`, 'helper-call', 'undemonstrated-read']],
    `the read is handed a list element rather than the enclosing renderer's own criterion, so the census cannot show it belongs to any one criterion's line; sites read ${sites.map(describeSite).join(' | ')}`
  )

  escapeIsRed(
    sites,
    THREAD_LEVEL_SUMMARY,
    CENSUS_UNCLASSIFIABLE_PREFIX,
    `a settledness output printed once for the whole thread rather than on a criterion's own line is what this contract forbids, and it uses no array method to be caught by`
  )
})

test('contract.resume-path-has-no-settledness-aggregate.control.an-inlined-per-criterion-render-stays-allowed', () => {
  const sites = syntheticSites(INLINED_RENDER, INLINED_RENDER_MODULE_SOURCE)

  assert.deepEqual(
    sites.map((site) => [site.expression, site.mechanism, site.use]),
    [[`${HELPER_NAME}(entry)`, 'helper-call', 'per-criterion-render']],
    `reading settledness inside a map callback and spreading one rendered line per criterion is per-criterion rendering, not an aggregate; sites read ${sites.map(describeSite).join(' | ')}`
  )

  assert.doesNotThrow(
    () => census(sites, classifySettlednessSite),
    `inlining the per-criterion renderer into the map that spreads its lines preserves today's behaviour, and a census that turned that refactor red would be blocking correct code; sites read ${sites.map(describeSite).join(' | ')}`
  )
})
