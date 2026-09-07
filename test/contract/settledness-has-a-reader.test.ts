import { test } from 'node:test'
import assert from 'node:assert/strict'
import { census, type Classified } from '../support/census.ts'
import { flattenSchemaNodes, isPlainObject } from '../support/schema-nodes.ts'
import { ThreadRecord, type Criterion, type Settledness, type Thread } from '../../src/schema/thread.ts'
import { renderBriefing, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { renderThreadDetail, type BindingIntegrity } from '../../src/server/resource-render.ts'

const SETTLEDNESS_SCHEMA_PATH = `${ThreadRecord.name}.completion_criteria[].settledness`

const NO_DECISIONS: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }
const NO_BINDINGS: BindingIntegrity = { bound: [], unreadable: 0, unread: false }

const THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1'
const CRITERION_ORDINAL = 1
const CRITERION_TEXT = 'the criterion text'
const CRITERION_LINE_MARKER = `c${CRITERION_ORDINAL} [open] [`
const SETTLED_BY_SENTINEL = 'zq-settled-by-sentinel-7f3a'

const halt = (detail: string): never => {
  throw new Error(`settledness-has-a-reader: ${detail}`)
}

type Disposition = { label: string; quoteReaches: boolean }

const DISPOSITIONS: Readonly<Record<Settledness, Disposition>> = {
  confirmed: { label: 'confirmed', quoteReaches: true },
  proposed: { label: 'proposed', quoteReaches: false },
  unsettled: { label: 'unsettled', quoteReaches: false }
}

const dispositionsByName: Readonly<Record<string, Disposition>> = DISPOSITIONS

const dispositionFor = (value: string): Disposition | undefined => dispositionsByName[value]

const isSettledness = (value: string): value is Settledness => dispositionFor(value) !== undefined

const classifySettlednessValue = (value: string): Classified<string>['verdict'] | 'unclassifiable' =>
  dispositionFor(value) === undefined ? 'unclassifiable' : 'allowed'

const settlednessEnumValues = (): string[] => {
  const node = flattenSchemaNodes(ThreadRecord.jsonSchema, ThreadRecord.name).find(
    (entry) => entry.path === SETTLEDNESS_SCHEMA_PATH
  )
  if (node === undefined) return halt(`${SETTLEDNESS_SCHEMA_PATH} is absent from the thread record schema`)
  if (!isPlainObject(node.value)) return halt(`${SETTLEDNESS_SCHEMA_PATH} is not a plain-object schema node`)
  const declared = node.value.enum
  if (!Array.isArray(declared)) {
    return halt(`${SETTLEDNESS_SCHEMA_PATH} declares no enum, so the census has no population to run over`)
  }
  return declared.map((value) =>
    typeof value === 'string' ? value : halt(`${SETTLEDNESS_SCHEMA_PATH} declares a non-string member ${String(value)}`)
  )
}

const assertPopulationIsSound = (population: readonly string[]): void => {
  assert.ok(
    population.length > 0,
    `settledness-has-a-reader: ${SETTLEDNESS_SCHEMA_PATH} yielded no value; a census over an empty list proves nothing`
  )
  assert.doesNotThrow(
    () => census([...population], classifySettlednessValue),
    `settledness-has-a-reader: ${SETTLEDNESS_SCHEMA_PATH} declares a value the disposition table does not name, so no surface is asserted to read it`
  )
  for (const named of Object.keys(DISPOSITIONS)) {
    assert.ok(
      population.includes(named),
      `settledness-has-a-reader: the disposition table names ${named}, which ${SETTLEDNESS_SCHEMA_PATH} no longer declares`
    )
  }
}

const settlednessOf = (value: string): Settledness =>
  isSettledness(value) ? value : halt(`${value} passed the census yet carries no disposition`)

const criterionBase: Omit<Criterion, 'settledness'> = {
  id: CRITERION_ID,
  ordinal: CRITERION_ORDINAL,
  text: CRITERION_TEXT,
  done: false,
  kind: 'planned',
  struck_by: null,
  settled_by: null
}

const criterionAt = (settledness: Settledness, settledBy: string | null): Criterion => ({
  ...criterionBase,
  settledness,
  settled_by: settledBy
})

const criterionWithNoSettledness = (settledBy: string | null): Criterion => ({
  ...criterionBase,
  settled_by: settledBy
})

const threadWith = (criterion: Criterion): Thread => ({
  id: THREAD_ID,
  slug: 'settledness-reader-fixture',
  title: 'settledness reader fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [criterion],
  spine: {
    active_goal: 'prove settledness reaches a rendered surface',
    next_step: 'run the census',
    landed: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-09-07T00:00:00.000Z',
  updated_at: '2026-09-07T00:00:00.000Z'
})

type Surface = { name: string; render: (thread: Thread) => string }

const SURFACES: readonly Surface[] = [
  { name: 'renderBriefing', render: (thread) => renderBriefing(thread, NO_DECISIONS, null, null) },
  {
    name: 'renderThreadDetail',
    render: (thread) => renderThreadDetail(thread, NO_DECISIONS, null, null, NO_BINDINGS)
  }
]

const criterionLineOf = (surface: Surface, rendered: string): string => {
  const lines = rendered.split('\n').filter((line) => line.includes(CRITERION_LINE_MARKER))
  const only = lines[0]
  if (lines.length !== 1 || only === undefined) {
    return halt(`${surface.name} emitted ${lines.length} lines carrying ${CRITERION_LINE_MARKER}, and the probe reads exactly one`)
  }
  return only
}

test('settledness.every-declared-value-renders-distinguishably-on-both-surfaces', () => {
  const population = settlednessEnumValues()
  assertPopulationIsSound(population)

  for (const surface of SURFACES) {
    const lines = population.map((value) => {
      const settledness = settlednessOf(value)
      const line = criterionLineOf(surface, surface.render(threadWith(criterionAt(settledness, null))))
      assert.ok(
        line.includes(`[${DISPOSITIONS[settledness].label}]`),
        `settledness-has-a-reader: ${surface.name} rendered "${line}" for settledness ${value}, which does not carry [${DISPOSITIONS[settledness].label}]`
      )
      return line
    })
    assert.equal(
      new Set(lines).size,
      population.length,
      `settledness-has-a-reader: ${surface.name} rendered ${new Set(lines).size} distinct criterion lines for ${population.length} declared settledness values, so at least two values are indistinguishable and this surface is not reading the field`
    )
  }
})

test('settledness.a-sentinel-settled-by-quote-reaches-both-surfaces-exactly-where-it-is-admitted', () => {
  const population = settlednessEnumValues()
  assertPopulationIsSound(population)

  const admitting = population.filter((value) => dispositionFor(value)?.quoteReaches === true)
  assert.ok(
    admitting.length > 0,
    'settledness-has-a-reader: no declared settledness value admits the settled_by quote, so this census would assert the sentinel reaches nothing'
  )

  for (const surface of SURFACES) {
    for (const value of population) {
      const settledness = settlednessOf(value)
      const rendered = surface.render(threadWith(criterionAt(settledness, SETTLED_BY_SENTINEL)))
      assert.equal(
        rendered.includes(SETTLED_BY_SENTINEL),
        DISPOSITIONS[settledness].quoteReaches,
        `settledness-has-a-reader: ${surface.name} ${rendered.includes(SETTLED_BY_SENTINEL) ? 'rendered' : 'withheld'} the settled_by sentinel for settledness ${value}, where the disposition table requires it ${DISPOSITIONS[settledness].quoteReaches ? 'rendered' : 'withheld'}`
      )
    }
  }
})

test('settledness.an-absent-value-renders-exactly-as-proposed-on-both-surfaces', () => {
  for (const surface of SURFACES) {
    const absent = surface.render(threadWith(criterionWithNoSettledness(null)))
    const proposed = surface.render(threadWith(criterionAt('proposed', null)))
    assert.equal(
      absent,
      proposed,
      `settledness-has-a-reader: ${surface.name} rendered a criterion carrying no settledness differently from one carrying proposed; criterionSettledness substitutes proposed at read time, so the whole rendering is deliberately indistinguishable and the distinctness census above claims nothing about absence`
    )
  }
})

test('settledness.control.an-undeclared-value-halts-the-census', () => {
  assert.equal(classifySettlednessValue('probably'), 'unclassifiable')
  assert.equal(classifySettlednessValue('confirmed'), 'allowed')
  assert.throws(
    () => census(['probably'], classifySettlednessValue),
    /census halted on an unclassifiable item/,
    'a fourth settledness value must halt the census rather than pass through it unread'
  )
})
