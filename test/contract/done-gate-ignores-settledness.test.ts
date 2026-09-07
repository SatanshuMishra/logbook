import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'
import { flattenSchemaNodes, isPlainObject } from '../support/schema-nodes.ts'
import { testRuntime } from '../support/runtime.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { ThreadRecord, type Criterion, type Thread } from '../../src/schema/thread.ts'
import { transition } from '../../src/domain/lifecycle.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SRC_ROOT = path.join(PROJECT_ROOT, 'src')
const GATE_REL_PATH = 'src/domain/done-gate.ts'
const REFUSING_REL_PATH = 'src/server/tools/close_thread.ts'
const POSITIVE_CONTROL_REL_PATH = 'src/schema/thread.ts'

const SETTLEDNESS_READERS_ADMITTED_BY_A16 = [
  'src/server/tools/open_thread.ts',
  'src/server/tools/amend_criteria.ts'
] as const

const SETTLEDNESS_SCHEMA_PATH = `${ThreadRecord.name}.completion_criteria[].settledness`

const SETTLEDNESS_IDENTIFIERS = ['settledness', 'settled_by', 'criterionSettledness', 'Settledness'] as const

const IMPORT_STATEMENT_PATTERN = /^[ \t]*(?:import|export)[ \t]+([A-Za-z0-9_$*,{}\s]+?)[ \t\r\n]*from[ \t]*['"]([^'"]+)['"]/gm

const IMPORT_LINE_PATTERN = /^[ \t]*import\b/

const TYPE_BINDING_PATTERN = /^type\b/

const BRACED_CLAUSE_PATTERN = /^\{([\s\S]*)\}$/

const SETTLED_IN_PROSE_PATTERN = /settled/i

type SourceFile = { relPath: string; text: string | null; readError: string | null }

type BoundaryFile = { relPath: string; readable: boolean; empty: boolean; matches: string[] }

type ImportStatement = { specifier: string; typeOnly: boolean; line: number }

type ImportEdge = { target: string; typeOnly: boolean }

type GraphNode = { relPath: string; edges: ImportEdge[] }

const halt = (detail: string): never => {
  throw new Error(`done-gate boundary: ${detail}`)
}

const walkTsFiles = (root: string): string[] => {
  if (!existsSync(root)) return []
  const entries = readdirSync(root, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) return walkTsFiles(full)
    if (entry.isFile() && entry.name.endsWith('.ts')) return [full]
    return []
  })
}

const toRelPath = (full: string): string => path.relative(PROJECT_ROOT, full).split(path.sep).join('/')

const readSourceFile = (full: string): SourceFile => {
  const relPath = toRelPath(full)
  try {
    return { relPath, text: readFileSync(full, 'utf8'), readError: null }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { relPath, text: null, readError: reason }
  }
}

const syntheticSource = (relPath: string, text: string): SourceFile => ({ relPath, text, readError: null })

const summarise = (file: SourceFile): BoundaryFile => {
  const text = file.text
  if (text === null) return { relPath: file.relPath, readable: false, empty: false, matches: [] }
  return {
    relPath: file.relPath,
    readable: true,
    empty: text.trim().length === 0,
    matches: SETTLEDNESS_IDENTIFIERS.filter((identifier) => text.includes(identifier))
  }
}

const isTypeOnlyClause = (clause: string): boolean => {
  const normalised = clause.trim().replace(/\s+/g, ' ')
  if (TYPE_BINDING_PATTERN.test(normalised)) return true
  const braced = BRACED_CLAUSE_PATTERN.exec(normalised)
  const inner = braced === null ? null : braced[1]
  if (inner === undefined || inner === null) return false
  return inner
    .split(',')
    .map((binding) => binding.trim())
    .filter((binding) => binding.length > 0)
    .every((binding) => TYPE_BINDING_PATTERN.test(binding))
}

const lineOfOffset = (text: string, offset: number): number => text.slice(0, offset).split('\n').length

const importStatementsOf = (text: string): ImportStatement[] =>
  [...text.matchAll(IMPORT_STATEMENT_PATTERN)].flatMap((match) => {
    const clause = match[1]
    const specifier = match[2]
    if (clause === undefined || specifier === undefined) return []
    return [{ specifier, typeOnly: isTypeOnlyClause(clause), line: lineOfOffset(text, match.index ?? 0) }]
  })

const unparsedImportLines = (text: string, parsedLines: readonly number[]): number[] =>
  text
    .split('\n')
    .flatMap((line, index) => (IMPORT_LINE_PATTERN.test(line) && !parsedLines.includes(index + 1) ? [index + 1] : []))

const resolveSpecifier = (fromRelPath: string, specifier: string): string =>
  path.posix.normalize(path.posix.join(path.posix.dirname(fromRelPath), specifier))

const edgesOf = (source: SourceFile, known: readonly string[]): GraphNode => {
  const text = source.text
  if (text === null) {
    return halt(
      `${source.relPath} could not be read (${source.readError ?? 'no reason reported'}), so an import edge out of it may be missing and the boundary would be understated`
    )
  }
  const statements = importStatementsOf(text)
  const missed = unparsedImportLines(
    text,
    statements.map((statement) => statement.line)
  )
  if (missed.length > 0) {
    return halt(
      `${source.relPath} begins an import statement at line ${missed.join(', ')} that this derivation could not parse, so an edge may be missing and the boundary would be understated`
    )
  }
  const edges = statements
    .filter((statement) => statement.specifier.startsWith('.'))
    .map((statement) => ({
      target: resolveSpecifier(source.relPath, statement.specifier),
      typeOnly: statement.typeOnly
    }))
  const unresolved = edges.filter((edge) => !known.includes(edge.target))
  if (unresolved.length > 0) {
    return halt(
      `${source.relPath} imports ${unresolved.map((edge) => edge.target).join(', ')}, which the scan of src/ never found, so the derivation cannot tell whether that file reaches the gate`
    )
  }
  return { relPath: source.relPath, edges }
}

const buildGraph = (sources: readonly SourceFile[]): GraphNode[] => {
  const known = sources.map((source) => source.relPath)
  return sources.map((source) => edgesOf(source, known))
}

const admitsValueEdge = (edge: ImportEdge): boolean => !edge.typeOnly

const admitsEveryEdge = (): boolean => true

const closeOver = (graph: readonly GraphNode[], seed: string, admits: (edge: ImportEdge) => boolean): string[] => {
  const grow = (reached: readonly string[]): readonly string[] => {
    const joined = graph
      .filter((node) => !reached.includes(node.relPath))
      .filter((node) => node.edges.some((edge) => admits(edge) && reached.includes(edge.target)))
      .map((node) => node.relPath)
    return joined.length === 0 ? reached : grow([...reached, ...joined])
  }
  return [...grow([seed])].sort()
}

const directImportersOf = (graph: readonly GraphNode[], seed: string): string[] =>
  [
    seed,
    ...graph
      .filter((node) => node.relPath !== seed && node.edges.some((edge) => edge.target === seed))
      .map((node) => node.relPath)
  ].sort()

const sourceAt = (sources: readonly SourceFile[], relPath: string): SourceFile =>
  sources.find((source) => source.relPath === relPath) ??
  halt(`${relPath} was derived into the boundary yet is absent from the scan of src/`)

const settlednessEnumValues = (): string[] => {
  const node = flattenSchemaNodes(ThreadRecord.jsonSchema, ThreadRecord.name).find(
    (entry) => entry.path === SETTLEDNESS_SCHEMA_PATH
  )
  if (node === undefined) {
    return halt(`${SETTLEDNESS_SCHEMA_PATH} is absent from the thread record schema, so the declared values cannot be read`)
  }
  if (!isPlainObject(node.value)) return halt(`${SETTLEDNESS_SCHEMA_PATH} is not a plain-object schema node`)
  const declared = node.value.enum
  if (!Array.isArray(declared)) {
    return halt(`${SETTLEDNESS_SCHEMA_PATH} declares no enum, so this test has no population to run over`)
  }
  return declared.map((value) =>
    typeof value === 'string' ? value : halt(`${SETTLEDNESS_SCHEMA_PATH} declares a non-string member ${String(value)}`)
  )
}

const classifyBoundaryFile = (file: BoundaryFile): Classified<BoundaryFile>['verdict'] | 'unclassifiable' => {
  if (!file.readable) return 'unclassifiable'
  if (file.empty) return 'unclassifiable'
  return file.matches.length > 0 ? 'forbidden' : 'allowed'
}

const criterionFields = (rt: Runtime, done: boolean): Omit<Criterion, 'settledness'> => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'whether the merge order matters is not known yet',
  done,
  kind: 'planned',
  struck_by: null,
  settled_by: null
})

const unsettledCriterion = (rt: Runtime, done: boolean): Criterion => ({
  ...criterionFields(rt, done),
  settledness: 'unsettled'
})

const withoutFixtureEcho = (message: string, criterion: Criterion): string =>
  message.replaceAll(criterion.id, '').replaceAll(criterion.text, '')

const threadFields = (rt: Runtime): Omit<Thread, 'completion_criteria'> => ({
  id: rt.ulid(),
  slug: 'gate-settledness-thread',
  title: 'Gate settledness thread',
  status: 'open',
  blocked_by: null,
  spine: {
    active_goal: 'take a thread holding an unsettled criterion through the done gate',
    next_step: 'read the verdict the gate produces',
    landed: '',
    last_session: 'wrote the gate census',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const threadWithOneCriterion = (rt: Runtime, criterion: Criterion): Thread => ({
  ...threadFields(rt),
  completion_criteria: [criterion]
})

const threadCarryingSettledness = (rt: Runtime, settledness: string): Thread => {
  const parsed = ThreadRecord.parse({
    ...threadFields(rt),
    completion_criteria: [{ ...criterionFields(rt, true), settledness }]
  })
  if (!parsed.ok) {
    return halt(
      `the thread record schema refused a fixture carrying the declared settledness ${settledness}: ${parsed.message}`
    )
  }
  return parsed.value
}

const onlyCriterion = (thread: Thread): Criterion => {
  const [criterion, ...rest] = thread.completion_criteria
  if (criterion === undefined || rest.length > 0) {
    return halt(`the fixture thread carries ${thread.completion_criteria.length} criteria, and this test reads exactly one`)
  }
  return criterion
}

test('contract.done-gate-ignores-settledness.no-file-deciding-or-refusing-on-the-gate-verdict-reads-settledness', () => {
  const sources = walkTsFiles(SRC_ROOT).map(readSourceFile)
  assert.ok(
    sources.length > 0,
    `done-gate census: no .ts file was found under ${SRC_ROOT}, so the import graph is empty and every derivation over it proves nothing`
  )

  const graph = buildGraph(sources)
  const boundary = closeOver(graph, GATE_REL_PATH, admitsValueEdge)
  const everyEdgeBoundary = closeOver(graph, GATE_REL_PATH, admitsEveryEdge)
  const direct = directImportersOf(graph, GATE_REL_PATH)

  assert.ok(
    boundary.length > 0,
    `done-gate census: no file under src/ was derived from ${GATE_REL_PATH}; a census over an empty list proves nothing`
  )
  assert.ok(
    boundary.includes(GATE_REL_PATH),
    `done-gate census: the derivation lost ${GATE_REL_PATH} itself; derived ${boundary.join(', ')}`
  )

  const importers = boundary.filter((relPath) => relPath !== GATE_REL_PATH)
  assert.ok(
    importers.length > 0,
    `done-gate census: the derivation found no importer of ${GATE_REL_PATH} besides itself, so the import scan is broken and the census would cover the gate alone`
  )
  assert.ok(
    boundary.length > direct.length,
    `done-gate census: the value-edge closure derived ${boundary.length} files against ${direct.length} direct importers of ${GATE_REL_PATH}, so it stopped at the first hop instead of following the gate verdict onward; derived ${boundary.join(', ')}`
  )
  assert.ok(
    boundary.includes(REFUSING_REL_PATH),
    `done-gate census: ${REFUSING_REL_PATH} is the file that turns the gate verdict into a refusal, and the closure did not reach it, so this census would say nothing about the surface that refuses; derived ${boundary.join(', ')}`
  )

  for (const reader of SETTLEDNESS_READERS_ADMITTED_BY_A16) {
    assert.equal(
      boundary.includes(reader),
      false,
      `done-gate census: ${reader} entered the boundary, and it reads settledness legitimately because A16 requires all three values to be accepted at creation and at insert; a type-only import is erased at runtime and cannot carry a gate verdict, so its presence means the type-only edge filter has stopped working and the closure has collapsed onto every file that imports a type from the tool layer; derived ${boundary.join(', ')}`
    )
  }

  assert.ok(
    everyEdgeBoundary.length > boundary.length,
    `done-gate census: closing over every import edge derived ${everyEdgeBoundary.length} files and closing over value edges alone derived ${boundary.length}, so the type-only edge filter removed nothing and this census is not proven to be the value-edge boundary it claims`
  )

  const summaries = boundary.map((relPath) => summarise(sourceAt(sources, relPath)))
  for (const file of summaries) {
    assert.equal(file.readable, true, `done-gate census: ${file.relPath} could not be read, so its source was never scanned`)
    assert.equal(file.empty, false, `done-gate census: ${file.relPath} holds no source text, so scanning it proves nothing`)
  }

  const control = summarise(readSourceFile(path.join(PROJECT_ROOT, POSITIVE_CONTROL_REL_PATH)))
  assert.equal(
    control.readable,
    true,
    `done-gate census: the positive control ${POSITIVE_CONTROL_REL_PATH} could not be read, so the matcher was never proven to match anything`
  )
  assert.ok(
    control.matches.length > 0,
    `done-gate census: the matcher found no settledness identifier in ${POSITIVE_CONTROL_REL_PATH}, which declares them, so a clean census result means nothing`
  )

  assert.doesNotThrow(
    () => census(summaries, classifyBoundaryFile),
    `done-gate census: every file reachable from ${GATE_REL_PATH} through value imports decides or refuses on the gate verdict, and none of them may read settledness; boundary ${boundary.join(', ')}`
  )
})

test('contract.done-gate-ignores-settledness.an-unsettled-criterion-is-refused-for-doneness-not-for-settledness', () => {
  const rt = testRuntime()
  const criterion = unsettledCriterion(rt, false)
  const thread = threadWithOneCriterion(rt, criterion)

  const result = transition(rt, thread, 'done', 'a valid closure statement')

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected transition to refuse closing a thread whose only un-struck criterion is not done')
  }

  assert.equal(result.field, 'outcome')
  assert.ok(
    result.accepted.includes('every un-struck completion criterion is marked done'),
    `expected the refusal to accept on doneness; accepted read: ${result.accepted}`
  )
  assert.ok(
    result.message.includes('every un-struck completion criterion to be marked done'),
    `expected the refusal message to name the doneness requirement; message read: ${result.message}`
  )
  assert.ok(
    result.message.includes(criterion.id),
    `expected the refusal message to name the outstanding criterion ${criterion.id}; message read: ${result.message}`
  )

  assert.ok(
    result.message.includes(criterion.text),
    `expected the refusal message to quote the outstanding criterion text; message read: ${result.message}`
  )

  const strippedMessage = withoutFixtureEcho(result.message, criterion)
  assert.notEqual(
    strippedMessage,
    result.message,
    `expected the fixture echo to be removable from the refusal message, otherwise the settledness scan is running over unstripped fixture text; message read: ${result.message}`
  )

  const proseSurfaces = [result.field, result.accepted, result.example, strippedMessage]
  for (const surface of proseSurfaces) {
    assert.equal(
      SETTLED_IN_PROSE_PATTERN.test(surface),
      false,
      `expected the refusal to say nothing about settledness; surface read: ${surface}`
    )
  }
})

test('contract.done-gate-ignores-settledness.every-declared-settledness-value-closes-a-thread-whose-criteria-are-done', () => {
  const population = settlednessEnumValues()
  assert.ok(
    population.length > 0,
    `done-gate settledness loop: ${SETTLEDNESS_SCHEMA_PATH} yielded no value, so a loop over it would assert nothing about any settledness value`
  )

  for (const settledness of population) {
    const rt = testRuntime()
    const thread = threadCarryingSettledness(rt, settledness)
    const criterion = onlyCriterion(thread)

    assert.equal(
      criterion.settledness,
      settledness,
      `expected the fixture criterion to carry the declared settledness ${settledness} after the thread record schema parsed it, otherwise this iteration never exercises that value`
    )
    assert.equal(
      criterion.done,
      true,
      `expected the fixture criterion to be marked done for settledness ${settledness}, otherwise the doneness branch decides this iteration`
    )

    const result = transition(rt, thread, 'done', 'a valid closure statement')

    assert.equal(
      result.ok,
      true,
      `expected a thread whose every un-struck criterion is done to close while that criterion carries settledness ${settledness}; result read: ${JSON.stringify(result)}`
    )
    if (!result.ok) {
      throw new Error(
        `expected transition to close the thread carrying settledness ${settledness}; refusal read: ${JSON.stringify(result)}`
      )
    }

    assert.equal(
      result.value.status,
      'done',
      `expected the closed thread to carry status done for settledness ${settledness}; thread read: ${JSON.stringify(result.value)}`
    )
    assert.ok(
      result.value.completion_criteria.some(
        (closed) => closed.id === criterion.id && closed.settledness === settledness
      ),
      `expected closing to leave the criterion settledness ${settledness} untouched; criteria read: ${JSON.stringify(result.value.completion_criteria)}`
    )
  }
})

test('contract.done-gate-ignores-settledness.control.a-settledness-read-halts-the-census', () => {
  const reader = summarise(
    syntheticSource('src/domain/lifecycle.ts', "if (criterion.settledness === 'unsettled') return refuseUnsettled()\n")
  )
  const clean = summarise(syntheticSource('src/domain/lifecycle.ts', 'if (!criterion.done) return refuseGate(failure)\n'))
  const blank = summarise(syntheticSource('src/domain/lifecycle.ts', ''))
  const unreadable: BoundaryFile = summarise({
    relPath: 'src/domain/lifecycle.ts',
    text: null,
    readError: 'ENOENT: no such file or directory'
  })

  assert.deepStrictEqual(reader.matches, ['settledness'])
  assert.deepStrictEqual(clean.matches, [])

  assert.equal(classifyBoundaryFile(reader), 'forbidden')
  assert.equal(classifyBoundaryFile(clean), 'allowed')
  assert.equal(classifyBoundaryFile(blank), 'unclassifiable')
  assert.equal(classifyBoundaryFile(unreadable), 'unclassifiable')

  assert.throws(() => census([reader], classifyBoundaryFile))
  assert.doesNotThrow(() => census([clean], classifyBoundaryFile))
  assert.throws(() => census([blank], classifyBoundaryFile))
  assert.throws(() => census([unreadable], classifyBoundaryFile))
})

test('contract.done-gate-ignores-settledness.control.only-a-value-edge-extends-the-boundary', () => {
  assert.equal(isTypeOnlyClause('type { ToolSpec }'), true)
  assert.equal(isTypeOnlyClause('type Runtime'), true)
  assert.equal(isTypeOnlyClause('{ type Ok, type Refusal }'), true)
  assert.equal(isTypeOnlyClause('{ transition }'), false)
  assert.equal(isTypeOnlyClause('{ declare, type Refusal }'), false)
  assert.equal(isTypeOnlyClause('* as caps'), false)
  assert.equal(isTypeOnlyClause('path'), false)

  const prose = importStatementsOf(
    "const refusal = 'a records directory this store may delete stale record files from \\'.\\/records\\''\n"
  )
  assert.deepStrictEqual(
    prose,
    [],
    `expected prose quoting a path to yield no import edge, otherwise the derivation invents edges out of strings; read ${JSON.stringify(prose)}`
  )

  const multiLineSource = [
    "import type { ToolSpec } from '../register.ts'",
    'import {',
    '  transition',
    "} from '../../domain/lifecycle.ts'",
    ''
  ].join('\n')
  const parsed = importStatementsOf(multiLineSource)
  assert.deepStrictEqual(
    parsed,
    [
      { specifier: '../register.ts', typeOnly: true, line: 1 },
      { specifier: '../../domain/lifecycle.ts', typeOnly: false, line: 2 }
    ],
    `expected a type-only import and a multi-line value import to be read as one statement each, at the line each begins on; read ${JSON.stringify(parsed)}`
  )
  const unparsableText = "import fs = require('node:fs')\n"
  const unparsableStatements = importStatementsOf(unparsableText)
  assert.equal(
    unparsableStatements.length,
    0,
    `expected an import written in a form this derivation does not read to yield no statement; read ${JSON.stringify(unparsableStatements)}`
  )
  assert.deepStrictEqual(
    unparsedImportLines(
      unparsableText,
      unparsableStatements.map((statement) => statement.line)
    ),
    [1],
    'expected an import line the derivation cannot parse to be reported, otherwise a missing edge would understate the boundary silently'
  )

  const graph: GraphNode[] = [
    { relPath: 'seed.ts', edges: [] },
    { relPath: 'value-importer.ts', edges: [{ target: 'seed.ts', typeOnly: false }] },
    { relPath: 'type-importer.ts', edges: [{ target: 'seed.ts', typeOnly: true }] },
    { relPath: 'downstream.ts', edges: [{ target: 'value-importer.ts', typeOnly: false }] },
    { relPath: 'beyond-type-importer.ts', edges: [{ target: 'type-importer.ts', typeOnly: false }] }
  ]

  assert.deepStrictEqual(
    closeOver(graph, 'seed.ts', admitsValueEdge),
    ['downstream.ts', 'seed.ts', 'value-importer.ts'],
    'expected the value-edge closure to follow a value import onward from a file it already reached, and to stop at a type-only import because that import is erased at runtime and cannot carry the seed value'
  )
  assert.deepStrictEqual(
    closeOver(graph, 'seed.ts', admitsEveryEdge),
    ['beyond-type-importer.ts', 'downstream.ts', 'seed.ts', 'type-importer.ts', 'value-importer.ts'],
    'expected a closure that admits every edge to reach the files behind a type-only import, which is what makes the edge filter the cause of their exclusion above'
  )
  assert.deepStrictEqual(directImportersOf(graph, 'seed.ts'), ['seed.ts', 'type-importer.ts', 'value-importer.ts'])
})
