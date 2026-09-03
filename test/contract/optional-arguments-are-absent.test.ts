import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { declare } from '../../src/schema/declare.ts'
import { census } from '../support/census.ts'
import { flattenSchemaNodes, isPlainObject } from '../support/schema-nodes.ts'
import { RECIPES, TEST_2_CASES, isEmptyish, withSingleFixture } from '../support/optional-argument-recipes.ts'

type Verdict = 'allowed' | 'forbidden' | 'unclassifiable'

type LandingSiteEntry = {
  path: string
  site: string
  omitted: unknown
  refused: boolean
  noDifference: boolean
  refusal: { field: string; message: string } | null
}

const parentPathOf = (path: string): string | null => {
  if (path.endsWith('[]')) return path.slice(0, -2)
  const dot = path.lastIndexOf('.')
  return dot === -1 ? null : path.slice(0, dot)
}

const keyOf = (path: string): string | null => {
  if (path.endsWith('[]')) return null
  const dot = path.lastIndexOf('.')
  return dot === -1 ? null : path.slice(dot + 1)
}

const collectOptionalArguments = (toolName: string, rootSchema: Record<string, unknown>): string[] => {
  const nodes = flattenSchemaNodes(rootSchema, toolName)
  const nodesByPath = new Map<string, unknown>([[toolName, rootSchema]])
  for (const node of nodes) nodesByPath.set(node.path, node.value)

  const optional: string[] = []
  for (const node of nodes) {
    const key = keyOf(node.path)
    if (key === null) continue
    const parentPath = parentPathOf(node.path)
    if (parentPath === null) continue
    const parent = nodesByPath.get(parentPath)
    if (!isPlainObject(parent)) continue
    const required = Array.isArray(parent.required) ? parent.required : []
    if (!required.includes(key)) optional.push(node.path)
  }
  return [...new Set(optional)]
}

const derivePopulation = (): string[] =>
  ALL_TOOLS.flatMap((spec) =>
    collectOptionalArguments(spec.name, declare(spec.name, spec.input as unknown as z.ZodType).jsonSchema)
  )

const classifyLandingSite = (entry: LandingSiteEntry): Verdict => {
  if (entry.noDifference) return 'unclassifiable'
  if (entry.refused) return entry.refusal !== null && entry.refusal.field === keyOf(entry.path) ? 'allowed' : 'unclassifiable'
  if (isEmptyish(entry.omitted)) return 'allowed'
  const value = entry.omitted
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
    return 'forbidden'
  }
  return 'unclassifiable'
}

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute', async (t) => {
  const population = derivePopulation()
  assert.ok(
    population.length > 0,
    'contract.optional-arguments-are-absent: the population of optional tool-input arguments is empty'
  )

  const entries: LandingSiteEntry[] = []
  for (const path of population) {
    const recipe = RECIPES.get(path)
    if (recipe === undefined) {
      throw new Error(
        `contract.optional-arguments-are-absent: no registered sentinel builder for optional argument "${path}"`
      )
    }
    const result = await recipe()
    if (result.refused) {
      entries.push({ path, site: 'refused', omitted: undefined, refused: true, noDifference: false, refusal: result.refusal })
      t.diagnostic(`${path}: the omitted run was refused (${result.refusal?.field}): ${result.refusal?.message}`)
      continue
    }
    if (result.sites.length === 0) {
      t.diagnostic(`${path}: no landing site differed between the omitted and sentinel runs`)
      entries.push({
        path,
        site: 'no-landing-site',
        omitted: `supplying ${path} changed nothing on the response, the stored record or the pointer`,
        refused: false,
        noDifference: true,
        refusal: null
      })
      continue
    }
    for (const site of result.sites) {
      entries.push({ path, site: site.site, omitted: site.omitted, refused: false, noDifference: false, refusal: null })
      t.diagnostic(`${path}#${site.site}: omitted run carries ${JSON.stringify(site.omitted)}`)
    }
  }

  assert.doesNotThrow(
    () => census(entries, classifyLandingSite),
    `every derived landing site of an omitted optional argument must be empty, unchanged or refused:\n${entries
      .filter((entry) => classifyLandingSite(entry) !== 'allowed')
      .map((entry) => `${entry.path}#${entry.site}: ${JSON.stringify(entry.omitted)}`)
      .join('\n')}`
  )
})

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.a-derived-non-empty-value-is-forbidden', () => {
  const forbidden: LandingSiteEntry = {
    path: 'synthetic.probe',
    site: 'synthetic',
    omitted: 'criterion 1',
    refused: false,
    noDifference: false,
    refusal: null
  }
  assert.throws(
    () => census([forbidden], classifyLandingSite),
    /census rejected a forbidden item:/,
    'contract.optional-arguments-are-absent: a derived non-empty value must be rejected as forbidden, not halted as unclassifiable'
  )
})

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.an-unclassifiable-value-halts', () => {
  const weird: LandingSiteEntry = {
    path: 'synthetic.probe',
    site: 'synthetic',
    omitted: { nested: true },
    refused: false,
    noDifference: false,
    refusal: null
  }
  assert.throws(
    () => census([weird], classifyLandingSite),
    /census halted on an unclassifiable item:/,
    'contract.optional-arguments-are-absent: an unclassifiable value must halt the census, not be rejected as forbidden'
  )
})

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.a-refusal-naming-the-argument-is-allowed-an-unrelated-refusal-halts', () => {
  const namingTheArgument: LandingSiteEntry = {
    path: 'amend_criteria.criterion_id',
    site: 'refused',
    omitted: undefined,
    refused: true,
    noDifference: false,
    refusal: { field: 'criterion_id', message: 'criterion_id is required when operation is "rewrite".' }
  }
  assert.equal(
    classifyLandingSite(namingTheArgument),
    'allowed',
    'contract.optional-arguments-are-absent: a refusal naming the argument under test proves the omission was refused, not silently substituted'
  )
  assert.match(
    namingTheArgument.refusal?.message ?? '',
    /criterion_id is required/,
    'contract.optional-arguments-are-absent: the refusal message must name the argument under test'
  )

  const unrelatedRefusal: LandingSiteEntry = {
    path: 'amend_criteria.criterion_id',
    site: 'refused',
    omitted: undefined,
    refused: true,
    noDifference: false,
    refusal: { field: 'thread_id', message: 'thread_id must resolve to an existing thread.' }
  }
  assert.throws(
    () => census([unrelatedRefusal], classifyLandingSite),
    /census halted on an unclassifiable item:/,
    'contract.optional-arguments-are-absent: a refusal that does not name the argument under test must halt, not count as proof the argument had no effect'
  )
  assert.match(
    unrelatedRefusal.refusal?.message ?? '',
    /thread_id must resolve/,
    'contract.optional-arguments-are-absent: the unrelated refusal message must not mention the argument under test'
  )
})

test('contract.optional-arguments-are-absent.no-code-derives-a-substitute.control.a-zero-site-non-refused-entry-halts-a-zero-site-refused-entry-does-not', () => {
  const zeroSiteNotRefused: LandingSiteEntry = {
    path: 'synthetic.probe',
    site: 'no-landing-site',
    omitted: undefined,
    refused: false,
    noDifference: true,
    refusal: null
  }
  assert.throws(
    () => census([zeroSiteNotRefused], classifyLandingSite),
    /census halted on an unclassifiable item:/,
    'contract.optional-arguments-are-absent: a recipe that produced no landing site and was not refused must halt the census'
  )

  const zeroSiteRefused: LandingSiteEntry = {
    path: 'synthetic.probe',
    site: 'refused',
    omitted: undefined,
    refused: true,
    noDifference: false,
    refusal: { field: 'probe', message: 'probe is required.' }
  }
  assert.doesNotThrow(
    () => census([zeroSiteRefused], classifyLandingSite),
    'contract.optional-arguments-are-absent: a recipe whose omitted run was legitimately refused must not halt merely for producing no landing site'
  )
})

test('contract.optional-arguments-are-absent.the-response-reports-it-absent', async (t) => {
  const population = derivePopulation()
  const toolsWithOptionalArguments = new Set(population.map((path) => path.split('.')[0]))
  const cases = TEST_2_CASES.filter((testCase) => toolsWithOptionalArguments.has(testCase.tool))
  assert.ok(
    cases.length > 0,
    'contract.optional-arguments-are-absent: no tool in the population carries a registered test-2 case'
  )

  for (const testCase of cases) {
    const fixture = await withSingleFixture(testCase.setup)
    try {
      const result = await testCase.handler.handler(fixture.rt, {} as never, testCase.minimalArgs(fixture.ctx))
      if (!result.ok) {
        t.diagnostic(
          `${testCase.tool}: the minimal-args run was refused (${result.refusal.field}): ${result.refusal.message}`
        )
        continue
      }
      const attributable = testCase.attributable(result.structured)
      for (const [field, value] of Object.entries(attributable)) {
        assert.ok(
          isEmptyish(value),
          `contract.optional-arguments-are-absent: ${testCase.tool}.${field} carries a non-empty value (${JSON.stringify(value)}) though every optional argument was omitted`
        )
      }
    } finally {
      fixture.cleanup()
    }
  }
})
