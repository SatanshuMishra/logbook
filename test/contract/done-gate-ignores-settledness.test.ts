import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { census, type Classified } from '../support/census.ts'
import { flattenSchemaNodes, isPlainObject } from '../support/schema-nodes.ts'
import { testRuntime } from '../support/runtime.ts'
import { STUB_TOOL_CTX, withCriterionFixture } from '../support/criterion-fixture.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { ThreadRecord, type Criterion, type Thread } from '../../src/schema/thread.ts'
import { transition } from '../../src/domain/lifecycle.ts'
import { closeThreadTool } from '../../src/server/tools/close_thread.ts'
import { openStore } from '../../src/store/records.ts'

const halt = (detail: string): never => {
  throw new Error(`done-gate boundary: ${detail}`)
}

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SRC_ROOT = path.join(PROJECT_ROOT, 'src')
const GATE_REL_PATH = 'src/domain/done-gate.ts'
const REFUSING_REL_PATH = 'src/server/tools/close_thread.ts'
const POSITIVE_CONTROL_REL_PATH = 'src/schema/thread.ts'
const UNADMITTED_CONTROL_REL_PATH = 'src/domain/lifecycle.ts'
const ADMITTED_SETTLEDNESS_READ = 'const settledness = settlednessSplitOf(validated.value)\n'
const UNADMITTED_SETTLEDNESS_READ = 'if (criterion.settled_by === null) return refuseUnattributed()\n'

const SETTLEDNESS_READERS_ADMITTED_BY_A16 = [
  'src/server/tools/open_thread.ts',
  'src/server/tools/amend_criteria.ts'
] as const

const SETTLEDNESS_REPORTERS_ADMITTED_BY_O9: readonly string[] = [REFUSING_REL_PATH]

const SETTLEDNESS_SCHEMA_PATH = `${ThreadRecord.name}.completion_criteria[].settledness`

const CLOSE_OUTCOME_SCHEMA_PATH = `${closeThreadTool.name}.outcome`

const SETTLEDNESS_IDENTIFIERS = ['settledness', 'settled_by', 'criterionSettledness', 'Settledness'] as const

const SETTLEDNESS_IDENTIFIERS_ADMITTED_BY_O9: readonly string[] = [
  'settledness',
  'criterionSettledness',
  'Settledness'
].map((identifier) =>
  SETTLEDNESS_IDENTIFIERS.some((declared) => declared === identifier)
    ? identifier
    : halt(
        `the O9 admission names the identifier ${identifier}, which this census never matches on; it matches on ${SETTLEDNESS_IDENTIFIERS.join(', ')}, so the admission would excuse an identifier that has been renamed out from under it`
      )
)

const STRUCK_SETTLEDNESS = 'unsettled'

const CLOSE_DETAIL = 'closed the thread while a declared settledness value stood on every criterion it carried'

const CLOSE_REFUSAL_TEST_NAME = 'contract.done-gate-ignores-settledness.no-settledness-value-makes-close-thread-refuse'

const CENSUS_FORBIDDEN_PREFIX = 'census rejected a forbidden item:'

const CENSUS_UNCLASSIFIABLE_PREFIX = 'census halted on an unclassifiable item:'

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

const raisedBy =
  (prefix: string) =>
  (error: unknown): boolean =>
    error instanceof Error && error.message.startsWith(prefix)

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

const enumValuesAt = (jsonSchema: Record<string, unknown>, root: string, schemaPath: string): string[] => {
  const node = flattenSchemaNodes(jsonSchema, root).find((entry) => entry.path === schemaPath)
  if (node === undefined) {
    return halt(`${schemaPath} is absent from the ${root} schema, so the declared values cannot be read`)
  }
  if (!isPlainObject(node.value)) return halt(`${schemaPath} is not a plain-object schema node`)
  const declared = node.value.enum
  if (!Array.isArray(declared)) {
    return halt(`${schemaPath} declares no enum, so this test has no population to run over`)
  }
  return declared.map((value) =>
    typeof value === 'string' ? value : halt(`${schemaPath} declares a non-string member ${String(value)}`)
  )
}

const settlednessEnumValues = (): string[] =>
  enumValuesAt(ThreadRecord.jsonSchema, ThreadRecord.name, SETTLEDNESS_SCHEMA_PATH)

const closeOutcomeValues = (): string[] =>
  enumValuesAt(
    z.toJSONSchema(closeThreadTool.input, { target: 'draft-7', io: 'input' }) as Record<string, unknown>,
    closeThreadTool.name,
    CLOSE_OUTCOME_SCHEMA_PATH
  )

const classifyBoundaryFile = (file: BoundaryFile): Classified<BoundaryFile>['verdict'] | 'unclassifiable' => {
  if (!file.readable) return 'unclassifiable'
  if (file.empty) return 'unclassifiable'
  if (SETTLEDNESS_REPORTERS_ADMITTED_BY_O9.includes(file.relPath)) {
    return file.matches.every((identifier) => SETTLEDNESS_IDENTIFIERS_ADMITTED_BY_O9.includes(identifier))
      ? 'allowed'
      : 'forbidden'
  }
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

type FixtureCriterion = { settledness: string; struck: boolean }

type CloseFixture = { thread: Thread; requested: readonly FixtureCriterion[] }

type CloseOutcome = Parameters<typeof closeThreadTool.handler>[2]['outcome']

const closeFixture = (rt: Runtime, slug: string, requested: readonly FixtureCriterion[]): CloseFixture => {
  const parsed = ThreadRecord.parse({
    ...threadFields(rt),
    slug,
    completion_criteria: requested.map((entry, index) => ({
      ...criterionFields(rt, !entry.struck),
      ordinal: index + 1,
      struck_by: entry.struck ? rt.ulid() : null,
      settledness: entry.settledness
    }))
  })
  if (!parsed.ok) {
    return halt(`the thread record schema refused the close fixture ${slug}: ${parsed.message}`)
  }
  return { thread: parsed.value, requested }
}

const expectedSettlednessSplit = (population: readonly string[], thread: Thread): Record<string, number> =>
  Object.fromEntries(
    population.map((value) => [
      value,
      thread.completion_criteria.filter((criterion) => criterion.struck_by === null && criterion.settledness === value)
        .length
    ])
  )

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

  for (const reporter of SETTLEDNESS_REPORTERS_ADMITTED_BY_O9) {
    assert.ok(
      boundary.includes(reporter),
      `done-gate census: ${reporter} is admitted to read settledness because O9 makes its success reply owe the split, and the closure did not reach it, so the admission is dead and would silently excuse a file this census no longer covers; remove it from the admission list or restore the import path; derived ${boundary.join(', ')}`
    )

    const admitted = summarise(sourceAt(sources, reporter))
    assert.ok(
      admitted.matches.length > 0,
      `done-gate census: ${reporter} is admitted to read settledness under O9, and the matcher now finds none of ${SETTLEDNESS_IDENTIFIERS.join(', ')} in it, so the read the admission excuses has moved elsewhere and the admission now stands as a blanket permission over a file nothing re-examines; the admission is no longer needed and should be deleted`
    )
  }

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
    `done-gate census: every file reachable from ${GATE_REL_PATH} through value imports decides or refuses on the gate verdict, and none of them may read settledness, with one exception: ${REFUSING_REL_PATH} reads ${SETTLEDNESS_IDENTIFIERS_ADMITTED_BY_O9.join(', ')} only to count the split its success reply owes under O9, and never to decide or refuse, so it is admitted here and guarded instead by the behavioural test ${CLOSE_REFUSAL_TEST_NAME}, which drives the close_thread handler over every declared settledness value under every declared outcome and fails if any of them turns into a refusal; boundary ${boundary.join(', ')}`
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

test(CLOSE_REFUSAL_TEST_NAME, async () => {
  const population = settlednessEnumValues()
  assert.ok(
    population.length > 0,
    `close_thread settledness loop: ${SETTLEDNESS_SCHEMA_PATH} yielded no value, so a loop over an empty population asserts nothing about any settledness value; population read: ${JSON.stringify(population)}`
  )
  assert.ok(
    population.includes(STRUCK_SETTLEDNESS),
    `close_thread settledness loop: the struck-criterion fixture carries ${STRUCK_SETTLEDNESS} and ${SETTLEDNESS_SCHEMA_PATH} no longer declares it, so that fixture would exercise a value the schema does not have; population read: ${JSON.stringify(population)}`
  )

  const outcomes = closeOutcomeValues()
  assert.ok(
    outcomes.length > 0,
    `close_thread settledness loop: ${CLOSE_OUTCOME_SCHEMA_PATH} yielded no value, so a loop over an empty population would drive no close at all and would assert nothing under any outcome; outcomes read: ${JSON.stringify(outcomes)}`
  )

  await withCriterionFixture(async (rt) => {
    const opened = openStore(rt, rt.cwd)
    const openedRead = JSON.stringify(opened)
    assert.equal(
      opened.ok,
      true,
      `close_thread settledness loop: the fixture store did not open, so no fixture could be seeded; result read: ${openedRead}`
    )
    if (!opened.ok) {
      throw new Error(`close_thread settledness loop: the fixture store did not open; result read: ${openedRead}`)
    }
    const store = opened.value

    for (const outcome of outcomes) {
      const fixtures = population.flatMap((settledness) => [
        closeFixture(rt, `${outcome}-unstruck-${settledness}`, [{ settledness, struck: false }]),
        closeFixture(rt, `${outcome}-struck-${STRUCK_SETTLEDNESS}-beside-${settledness}`, [
          { settledness: STRUCK_SETTLEDNESS, struck: true },
          { settledness, struck: false }
        ])
      ])

      for (const { thread, requested } of fixtures) {
        assert.equal(
          thread.completion_criteria.length,
          requested.length,
          `close_thread settledness loop: the fixture ${thread.slug} asked for ${requested.length} criteria and came back carrying ${thread.completion_criteria.length}, so this iteration exercises a shape the fixture never described; criteria read: ${JSON.stringify(thread.completion_criteria)}`
        )
        requested.forEach((entry, index) => {
          const stored = thread.completion_criteria[index]
          assert.equal(
            stored?.settledness,
            entry.settledness,
            `close_thread settledness loop: expected criterion ${index + 1} of ${thread.slug} to carry the requested settledness ${entry.settledness} after the thread record schema parsed it, otherwise this iteration exercises a value the fixture never held; criterion read: ${JSON.stringify(stored)}`
          )
        })

        const seeded = store.commit([{ kind: 'thread', record: thread }], `seed the close fixture ${thread.slug}`)
        assert.equal(
          seeded.ok,
          true,
          `close_thread settledness loop: the fixture ${thread.slug} was not seeded into the store, so the close below would prove nothing; result read: ${JSON.stringify(seeded)}`
        )

        const closed = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
          thread_id: thread.id,
          outcome: outcome as CloseOutcome,
          detail: CLOSE_DETAIL
        })

        const closedRead = JSON.stringify(closed)
        assert.equal(
          closed.ok,
          true,
          `expected close_thread to close ${thread.slug} as ${outcome}, whose every un-struck criterion is marked done, whatever settledness those criteria carry, because no settledness count is ever a reason to refuse; result read: ${closedRead}`
        )
        if (!closed.ok) {
          throw new Error(`expected close_thread to close ${thread.slug} as ${outcome}; result read: ${closedRead}`)
        }

        assert.deepStrictEqual(
          closed.structured.settledness_split,
          expectedSettlednessSplit(population, thread),
          `expected the close of ${thread.slug} as ${outcome} to report how its un-struck criteria divide by settledness; split read: ${JSON.stringify(closed.structured.settledness_split)}`
        )
      }
    }
  })
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

  const admittedReader = summarise(syntheticSource(REFUSING_REL_PATH, ADMITTED_SETTLEDNESS_READ))
  const unadmittedReader = summarise(syntheticSource(UNADMITTED_CONTROL_REL_PATH, ADMITTED_SETTLEDNESS_READ))
  const admittedForeignReader = summarise(syntheticSource(REFUSING_REL_PATH, UNADMITTED_SETTLEDNESS_READ))
  const admittedBlank = summarise(syntheticSource(REFUSING_REL_PATH, ''))
  const admittedUnreadable: BoundaryFile = summarise({
    relPath: REFUSING_REL_PATH,
    text: null,
    readError: 'ENOENT: no such file or directory'
  })

  assert.deepStrictEqual(
    admittedReader.matches,
    ['settledness'],
    `expected the matcher to still find the settledness read in the admitted file, otherwise the admission is passing a file the matcher never flagged; matches read: ${JSON.stringify(admittedReader.matches)}`
  )
  assert.equal(
    classifyBoundaryFile(admittedReader),
    'allowed',
    `expected ${REFUSING_REL_PATH} to be admitted because O9 makes its success reply owe the settledness split; verdict read: ${classifyBoundaryFile(admittedReader)}`
  )
  assert.equal(
    classifyBoundaryFile(unadmittedReader),
    'forbidden',
    `expected the same settledness read at ${UNADMITTED_CONTROL_REL_PATH} to stay forbidden, otherwise the admission is excusing the read rather than the one file that owes the split; verdict read: ${classifyBoundaryFile(unadmittedReader)}`
  )
  assert.deepStrictEqual(
    admittedForeignReader.matches,
    ['settled_by'],
    `expected the matcher to find settled_by in the admitted file, otherwise the identifier-scoped admission below is decided on an empty match list; matches read: ${JSON.stringify(admittedForeignReader.matches)}`
  )
  assert.equal(
    classifyBoundaryFile(admittedForeignReader),
    'forbidden',
    `expected ${REFUSING_REL_PATH} to stay forbidden when it reads settled_by, which the O9 split never reads, because the admission covers only ${SETTLEDNESS_IDENTIFIERS_ADMITTED_BY_O9.join(', ')}; verdict read: ${classifyBoundaryFile(admittedForeignReader)}`
  )
  assert.equal(
    classifyBoundaryFile(admittedBlank),
    'unclassifiable',
    `expected an empty ${REFUSING_REL_PATH} to halt the census, because the admission is about identifier matching and never about whether the file was scanned; verdict read: ${classifyBoundaryFile(admittedBlank)}`
  )
  assert.equal(
    classifyBoundaryFile(admittedUnreadable),
    'unclassifiable',
    `expected an unreadable ${REFUSING_REL_PATH} to halt the census, because the admission is about identifier matching and never about whether the file was scanned; verdict read: ${classifyBoundaryFile(admittedUnreadable)}`
  )

  assert.doesNotThrow(
    () => census([admittedReader], classifyBoundaryFile),
    `expected the census to pass ${REFUSING_REL_PATH} reading ${SETTLEDNESS_IDENTIFIERS_ADMITTED_BY_O9.join(', ')}, because O9 makes its success reply owe the settledness split`
  )
  assert.throws(
    () => census([unadmittedReader], classifyBoundaryFile),
    raisedBy(CENSUS_FORBIDDEN_PREFIX),
    `expected the census itself to reject the same settledness read at ${UNADMITTED_CONTROL_REL_PATH} as forbidden, rather than any error at all counting as a rejection`
  )
  assert.throws(
    () => census([admittedForeignReader], classifyBoundaryFile),
    raisedBy(CENSUS_FORBIDDEN_PREFIX),
    `expected the census itself to reject ${REFUSING_REL_PATH} reading settled_by as forbidden, because the O9 admission is scoped to ${SETTLEDNESS_IDENTIFIERS_ADMITTED_BY_O9.join(', ')} and covers no other identifier in that file`
  )
  assert.throws(
    () => census([admittedBlank], classifyBoundaryFile),
    raisedBy(CENSUS_UNCLASSIFIABLE_PREFIX),
    `expected the census itself to halt on an empty ${REFUSING_REL_PATH} as unclassifiable, rather than any error at all counting as a halt`
  )
  assert.throws(
    () => census([admittedUnreadable], classifyBoundaryFile),
    raisedBy(CENSUS_UNCLASSIFIABLE_PREFIX),
    `expected the census itself to halt on an unreadable ${REFUSING_REL_PATH} as unclassifiable, rather than any error at all counting as a halt`
  )
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
