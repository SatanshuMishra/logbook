import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ALL_TOOLS, registerTool, type ToolSpec } from '../../src/server/register.ts'
import { productionRuntime } from '../../src/runtime/runtime.ts'
import { census } from '../support/census.ts'
import {
  ARGUMENT_GAPS,
  PUBLISHED_CLAIMS,
  argumentPopulation,
  claimPopulation,
  classifyGapReachability,
  classifyGapReasonDistinctness,
  classifyPublishedArgument,
  classifyPublishedClaim,
  classifyPublishedInput,
  classifyRegistryName,
  gapReachability,
  gapReasonDistinctness,
  listPublishedTools,
  readRegistryCensus,
  registryPopulation,
  type ArgumentGap,
  type ClaimCensusItem,
  type PublishedTool,
  type RegistryCensus
} from '../support/published.ts'
import { CONTROL_SPECS, adaptProbeSpec, spawnProbeServer } from '../support/probe-server.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

type CensusItem = { name: string; inputSchema: Record<string, unknown>; enforcedKeys: readonly string[] | null }

const classifyCensusItem = (item: CensusItem): ReturnType<typeof classifyPublishedInput> =>
  item.enforcedKeys === null ? 'unclassifiable' : classifyPublishedInput(item.inputSchema, item.enforcedKeys)

const soleTool = (tools: PublishedTool[], name: string): PublishedTool => {
  const found = tools.find((tool) => tool.name === name)
  if (found === undefined) {
    throw new Error(`expected a published tool named "${name}", found: ${tools.map((t) => t.name).join(', ')}`)
  }
  return found
}

const soleCensusItem = (items: CensusItem[], name: string): CensusItem => {
  const found = items.find((item) => item.name === name)
  if (found === undefined) {
    throw new Error(`expected a census item named "${name}", found: ${items.map((i) => i.name).join(', ')}`)
  }
  return found
}

const joinPublishedToEnforced = (
  published: readonly PublishedTool[],
  registry: readonly Pick<ToolSpec<never, never>, 'name' | 'input'>[]
): CensusItem[] =>
  published.map((tool) => {
    const spec = registry.find((candidate) => candidate.name === tool.name)
    return {
      name: tool.name,
      inputSchema: tool.inputSchema,
      enforcedKeys: spec === undefined ? null : Object.keys(spec.input.shape)
    }
  })

const propertySchemaOf = (inputSchema: Record<string, unknown>, key: string): Record<string, unknown> => {
  const properties = inputSchema.properties
  if (typeof properties !== 'object' || properties === null) {
    throw new Error('propertySchemaOf: input schema carries no properties object')
  }
  const value = (properties as Record<string, unknown>)[key]
  if (typeof value !== 'object' || value === null) {
    throw new Error(`propertySchemaOf: property "${key}" is not an object schema`)
  }
  return value as Record<string, unknown>
}

const MCP_SERVER_MODULE_PATH = fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/server/mcp.js'))
const MCP_STDIO_MODULE_PATH = fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))
const ZOD_MODULE_PATH = fileURLToPath(import.meta.resolve('zod'))
const RUNTIME_MODULE_PATH = fileURLToPath(new URL('../../src/runtime/runtime.ts', import.meta.url))
const REGISTER_MODULE_PATH = fileURLToPath(new URL('../../src/server/register.ts', import.meta.url))

const DERIVE_PROBE_ENTRY_SOURCE = `
import { z } from '${ZOD_MODULE_PATH}'
import { McpServer } from '${MCP_SERVER_MODULE_PATH}'
import { StdioServerTransport } from '${MCP_STDIO_MODULE_PATH}'
import { productionRuntime } from '${RUNTIME_MODULE_PATH}'
import { registerTool } from '${REGISTER_MODULE_PATH}'

const rt = productionRuntime()
const server = new McpServer(
  { name: 'logbook-derive-probe', version: '0.0.0' },
  { capabilities: { tools: { listChanged: true } } }
)

registerTool(server, rt, {
  name: 'probe_multi_value_literal',
  title: 'probe_multi_value_literal',
  description: 'Registers a two-value literal field to prove the published schema keeps every literal value rather than narrowing to the first.',
  input: z.strictObject({ mode: z.literal(['a', 'b']) }),
  output: z.object({ mode: z.string() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_rt, _ctx, input) => ({ ok: true, text: 'echoed', structured: { mode: input.mode } })
})

registerTool(server, rt, {
  name: 'probe_discriminated_union',
  title: 'probe_discriminated_union',
  description: 'Registers a discriminated union field to prove the published schema keeps the discriminator rather than degrading to a plain union.',
  input: z.strictObject({
    payload: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.string() }),
      z.object({ kind: z.literal('b'), y: z.number() })
    ])
  }),
  output: z.object({ kind: z.string() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_rt, _ctx, input) => ({ ok: true, text: 'echoed', structured: { kind: input.payload.kind } })
})

registerTool(server, rt, {
  name: 'probe_strict_object',
  title: 'probe_strict_object',
  description: 'Registers a strict input object to prove an unknown key is not silently dropped before the strict re-validation runs.',
  input: z.strictObject({ a: z.string() }),
  output: z.object({ a: z.string() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_rt, _ctx, input) => ({ ok: true, text: 'echoed', structured: { a: input.a } })
})

const transport = new StdioServerTransport()
await server.connect(transport)
`

const spawnDeriveProbeServer = async (): Promise<SpawnedServer> => {
  const entryDir = mkdtempSync(join(tmpdir(), 'logbook-derive-probe-entry-'))
  const entryPath = join(entryDir, 'entry.ts')
  writeFileSync(entryPath, DERIVE_PROBE_ENTRY_SOURCE, 'utf8')
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT, entry: entryPath })
  return {
    client: spawned.client,
    stderr: spawned.stderr,
    instructions: spawned.instructions,
    close: async () => {
      await spawned.close()
      rmSync(entryDir, { recursive: true, force: true })
    }
  }
}

test('contract.published-schema-matches-enforced.production-registry-is-populated-and-consistent', async () => {
  assert.ok(ALL_TOOLS.length > 0, 'expected the production registry to carry at least one tool')
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = joinPublishedToEnforced(published, ALL_TOOLS)
    assert.ok(items.length > 0, 'expected at least one published tool to census')
    assert.doesNotThrow(() => census(items, classifyCensusItem))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const registryCensus = await readRegistryCensus(spawned)
    const population = registryPopulation(registryCensus)
    assert.ok(population.length > 0, 'expected the registry population to be non-empty now that tools are registered')
    assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, registryCensus)))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.registry-join.matched-tool-with-arguments-is-allowed', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.conformant])
  try {
    const published = await listPublishedTools(spawned)
    const registry = [adaptProbeSpec(CONTROL_SPECS.conformant)]
    const items = joinPublishedToEnforced(published, registry)
    const item = soleCensusItem(items, 'probe_conformant')
    assert.deepEqual(item.enforcedKeys, ['value'])
    assert.equal(classifyCensusItem(item), 'allowed')
    assert.doesNotThrow(() => census(items, classifyCensusItem))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.registry-join.unmatched-tool-is-unclassifiable', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.conformant])
  try {
    const published = await listPublishedTools(spawned)
    const items = joinPublishedToEnforced(published, [])
    const item = soleCensusItem(items, 'probe_conformant')
    assert.equal(item.enforcedKeys, null)
    assert.equal(classifyCensusItem(item), 'unclassifiable')
    assert.throws(
      () => census(items, classifyCensusItem),
      (error: unknown) => error instanceof Error && error.message.includes('probe_conformant')
    )
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.derive.multi-value-literal-preserves-every-value', async () => {
  const spawned = await spawnDeriveProbeServer()
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_multi_value_literal')
    const modeSchema = propertySchemaOf(tool.inputSchema, 'mode')
    assert.deepEqual(modeSchema.enum, ['a', 'b'])
    const first = await spawned.client.callTool({ name: 'probe_multi_value_literal', arguments: { mode: 'a' } })
    assert.equal(first.isError, undefined)
    assert.deepEqual(first.structuredContent, { mode: 'a' })
    const second = await spawned.client.callTool({ name: 'probe_multi_value_literal', arguments: { mode: 'b' } })
    assert.equal(second.isError, undefined)
    assert.deepEqual(second.structuredContent, { mode: 'b' })
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.derive.discriminated-union-keeps-its-discriminator', async () => {
  const spawned = await spawnDeriveProbeServer()
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_discriminated_union')
    const payloadSchema = propertySchemaOf(tool.inputSchema, 'payload')
    assert.ok('oneOf' in payloadSchema)
    assert.ok(!('anyOf' in payloadSchema))
    const result = await spawned.client.callTool({
      name: 'probe_discriminated_union',
      arguments: { payload: { kind: 'b', y: 5 } }
    })
    assert.equal(result.isError, undefined)
    assert.deepEqual(result.structuredContent, { kind: 'b' })
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.derive.unknown-key-reaches-strict-re-validation', async () => {
  const spawned = await spawnDeriveProbeServer()
  try {
    const result = await spawned.client.callTool({
      name: 'probe_strict_object',
      arguments: { a: 'ok', evil: 'x' }
    })
    assert.equal(result.isError, true)
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.control.conformant-is-allowed', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.conformant])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_conformant')
    const verdict = classifyPublishedInput(tool.inputSchema, ['value'])
    assert.equal(verdict, 'allowed')
    assert.doesNotThrow(() =>
      census([{ name: tool.name, inputSchema: tool.inputSchema, enforcedKeys: ['value'] }], classifyCensusItem)
    )
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.control.no-arguments-is-allowed', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.noArguments])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_no_arguments')
    const verdict = classifyPublishedInput(tool.inputSchema, [])
    assert.equal(verdict, 'allowed')
    assert.doesNotThrow(() =>
      census([{ name: tool.name, inputSchema: tool.inputSchema, enforcedKeys: [] }], classifyCensusItem)
    )
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.control.nullable-root-is-forbidden', () => {
  const server = new McpServer({ name: 'logbook-guard-probe', version: '0.0.0' }, { capabilities: { tools: {} } })
  const rt = productionRuntime()
  assert.throws(
    () => registerTool(server, rt, adaptProbeSpec(CONTROL_SPECS.nullableRoot)),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('probe_nullable_root') &&
      error.message.includes('root is not a plain object')
  )
})

test('contract.published-schema-matches-enforced.control.union-root-is-forbidden', () => {
  const server = new McpServer({ name: 'logbook-guard-probe', version: '0.0.0' }, { capabilities: { tools: {} } })
  const rt = productionRuntime()
  assert.throws(
    () => registerTool(server, rt, adaptProbeSpec(CONTROL_SPECS.unionRoot)),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('probe_union_root') &&
      error.message.includes('root is not a plain object')
  )
})

test('contract.published-schema-matches-enforced.classifier.root-union-keyword-is-unclassifiable', () => {
  const verdict = classifyPublishedInput({ anyOf: [{ type: 'string' }, { type: 'number' }] }, ['a'])
  assert.equal(verdict, 'unclassifiable')
})

test('contract.published-schema-matches-enforced.classifier.non-object-root-is-unclassifiable', () => {
  const verdict = classifyPublishedInput({ type: 'string' }, [])
  assert.equal(verdict, 'unclassifiable')
})

test('contract.published-schema-matches-enforced.classifier.missing-properties-is-unclassifiable', () => {
  const verdict = classifyPublishedInput({ type: 'object' }, [])
  assert.equal(verdict, 'unclassifiable')
})

test('contract.published-schema-matches-enforced.classifier.mismatched-non-empty-keys-is-forbidden', () => {
  const verdict = classifyPublishedInput({ type: 'object', properties: { a: {} } }, ['a', 'b'])
  assert.equal(verdict, 'forbidden')
})

test('contract.published-schema-matches-enforced.accidental-empty-input-schema-refuses-at-registration', () => {
  const server = new McpServer({ name: 'logbook-guard-probe', version: '0.0.0' }, { capabilities: { tools: {} } })
  const rt = productionRuntime()
  assert.throws(
    () =>
      registerTool(server, rt, {
        name: 'accidental_empty_input',
        title: 'accidental_empty_input',
        description: 'a tool that forgot to declare its arguments',
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: async () => ({ ok: true, text: 'unreachable', structured: { ok: true } })
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('accidental_empty_input') &&
      error.message.includes('NO_ARGUMENTS')
  )
})

test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-missing-from-one-side', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: [],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: ['ghost_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population].sort(), ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-every-axis', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool'],
    guardApproved: ['real_tool'],
    descriptionClaimsReachable: ['real_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['real_tool'])
  assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, syntheticCensus)))
})

test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-registered-but-not-guard-approved', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: ['ghost_tool'],
    guardApproved: [],
    descriptionClaimsReachable: ['ghost_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-guard-approved-but-not-registered', () => {
  const syntheticCensus: RegistryCensus = {
    files: [],
    registered: [],
    published: [],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-whose-claims-are-unreachable', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: ['ghost_tool'],
    guardApproved: ['ghost_tool'],
    descriptionClaimsReachable: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

const CLAIM_PROBE_TOOLS: PublishedTool[] = [
  {
    name: 'probe_claim_writer',
    description: 'A probe tool that publishes one argument named value.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
  }
]

const claimProbeItem = (phrase: string, providers: readonly string[] | null): ClaimCensusItem => ({
  tool: 'probe_claim_writer',
  description: 'A probe tool that publishes one argument named value.',
  phrase,
  providers
})

test('contract.published-schema-matches-enforced.claims.every-published-claim-is-reachable', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = claimPopulation(published)
    assert.ok(items.length > 0, 'expected the published tools to contribute at least one claim to census')
    assert.doesNotThrow(() => census(items, (item) => classifyPublishedClaim(item, published)))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.claims.park-thread-summary-fields-are-reachable', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = claimPopulation(published).filter((item) => item.tool === 'park_thread')
    assert.ok(items.length > 0, 'expected park_thread to contribute at least one claim to census')
    assert.doesNotThrow(() => census(items, (item) => classifyPublishedClaim(item, published)))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.claims.list-threads-blockage-promise-has-a-writer', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = claimPopulation(published).filter((item) => item.tool === 'list_threads')
    assert.ok(items.length > 0, 'expected list_threads to contribute at least one claim to census')
    assert.doesNotThrow(() => census(items, (item) => classifyPublishedClaim(item, published)))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.claims.control.an-undeclared-tool-halts-the-census', () => {
  const items = claimPopulation(CLAIM_PROBE_TOOLS)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.providers, null)
  assert.throws(
    () => census(items, (item) => classifyPublishedClaim(item, CLAIM_PROBE_TOOLS)),
    (error: unknown) => error instanceof Error && error.message.includes('probe_claim_writer')
  )
})

test('contract.published-schema-matches-enforced.claims.control.a-claim-with-no-providers-is-allowed', () => {
  const item = claimProbeItem('publishes one argument named value', [])
  assert.equal(classifyPublishedClaim(item, CLAIM_PROBE_TOOLS), 'allowed')
  assert.doesNotThrow(() => census([item], (candidate) => classifyPublishedClaim(candidate, CLAIM_PROBE_TOOLS)))
})

test('contract.published-schema-matches-enforced.claims.control.a-claim-naming-a-missing-key-is-forbidden', () => {
  const reachable = claimProbeItem('publishes one argument named value', ['probe_claim_writer.value'])
  assert.equal(classifyPublishedClaim(reachable, CLAIM_PROBE_TOOLS), 'allowed')
  const missing = claimProbeItem('publishes one argument named value', ['probe_claim_writer.absent'])
  assert.equal(classifyPublishedClaim(missing, CLAIM_PROBE_TOOLS), 'forbidden')
  assert.throws(
    () => census([missing], (candidate) => classifyPublishedClaim(candidate, CLAIM_PROBE_TOOLS)),
    (error: unknown) => error instanceof Error && error.message.includes('probe_claim_writer.absent')
  )
})

test('contract.published-schema-matches-enforced.claims.control.a-phrase-absent-from-the-description-halts-the-census', () => {
  const drifted = claimProbeItem('a clause this description does not carry', ['probe_claim_writer.value'])
  assert.equal(classifyPublishedClaim(drifted, CLAIM_PROBE_TOOLS), 'unclassifiable')
  assert.throws(
    () => census([drifted], (candidate) => classifyPublishedClaim(candidate, CLAIM_PROBE_TOOLS)),
    (error: unknown) => error instanceof Error && error.message.includes('a clause this description does not carry')
  )
})

test('contract.published-schema-matches-enforced.claims.control.an-unresolvable-provider-address-halts-the-census', () => {
  const noSeparator = claimProbeItem('publishes one argument named value', ['probe_claim_writer'])
  assert.equal(classifyPublishedClaim(noSeparator, CLAIM_PROBE_TOOLS), 'unclassifiable')
  const unknownTool = claimProbeItem('publishes one argument named value', ['probe_absent_tool.value'])
  assert.equal(classifyPublishedClaim(unknownTool, CLAIM_PROBE_TOOLS), 'unclassifiable')
})

test('contract.published-schema-matches-enforced.arguments.every-published-argument-is-claimed-or-enumerated', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const items = argumentPopulation(published)
    assert.ok(items.length > 0, 'expected the published tools to contribute at least one argument address to census')
    assert.doesNotThrow(() =>
      census([...items], (address) => classifyPublishedArgument(address, PUBLISHED_CLAIMS, ARGUMENT_GAPS))
    )
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.arguments.control.an-unclaimed-and-unenumerated-argument-halts-as-unclassifiable', () => {
  assert.equal(classifyPublishedArgument('probe_tool.mystery', {}, []), 'unclassifiable')
  assert.throws(
    () => census(['probe_tool.mystery'], (address) => classifyPublishedArgument(address, {}, [])),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('census halted on an unclassifiable item') &&
      error.message.includes('probe_tool.mystery')
  )
})

test('contract.published-schema-matches-enforced.arguments.control.an-enumerated-gap-with-a-blank-reason-halts-as-forbidden', () => {
  const gaps: ArgumentGap[] = [{ address: 'probe_tool.mystery', reason: '   ' }]
  assert.equal(classifyPublishedArgument('probe_tool.mystery', {}, gaps), 'forbidden')
  assert.throws(
    () => census(['probe_tool.mystery'], (address) => classifyPublishedArgument(address, {}, gaps)),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('census rejected a forbidden item') &&
      error.message.includes('probe_tool.mystery')
  )
})

test('contract.published-schema-matches-enforced.arguments.control.a-claimed-argument-is-allowed-even-when-not-enumerated', () => {
  const claims = { probe_tool: [{ phrase: 'x', providers: ['probe_tool.mystery'] }] }
  assert.equal(classifyPublishedArgument('probe_tool.mystery', claims, []), 'allowed')
})

test('contract.published-schema-matches-enforced.arguments.control.an-enumerated-gap-with-a-reason-is-allowed', () => {
  const gaps: ArgumentGap[] = [
    { address: 'probe_tool.mystery', reason: 'a specific, honest reason for this one address' }
  ]
  assert.equal(classifyPublishedArgument('probe_tool.mystery', {}, gaps), 'allowed')
})

test('contract.published-schema-matches-enforced.arguments.every-enumerated-gap-still-exists-on-the-live-surface', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    const population = argumentPopulation(published)
    assert.ok(population.length > 0, 'expected the published tools to contribute at least one argument address to census')
    const items = gapReachability(ARGUMENT_GAPS, population)
    assert.ok(items.length > 0, 'expected ARGUMENT_GAPS to enumerate at least one address to census')
    assert.doesNotThrow(() => census(items, classifyGapReachability))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.arguments.every-enumerated-gap-carries-a-reason-distinct-from-every-other', () => {
  const items = gapReasonDistinctness(ARGUMENT_GAPS)
  assert.ok(items.length > 0, 'expected ARGUMENT_GAPS to carry at least one entry to census')
  assert.doesNotThrow(() => census(items, classifyGapReasonDistinctness))
})

test('contract.published-schema-matches-enforced.arguments.control.a-stale-enumerated-gap-halts-while-a-live-one-passes', () => {
  const population = ['probe_tool.value']
  const gaps: ArgumentGap[] = [
    { address: 'probe_tool.value', reason: 'live address, still on the surface' },
    { address: 'probe_tool.ghost', reason: 'stale address, renamed or removed since this was written' }
  ]
  const items = gapReachability(gaps, population)
  assert.deepEqual(items, [
    { address: 'probe_tool.value', reachable: true },
    { address: 'probe_tool.ghost', reachable: false }
  ])
  assert.deepEqual(items.map(classifyGapReachability), ['allowed', 'unclassifiable'])
  assert.throws(
    () => census(items, classifyGapReachability),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('census halted on an unclassifiable item') &&
      error.message.includes('probe_tool.ghost') &&
      !error.message.includes('census rejected a forbidden item')
  )
  assert.doesNotThrow(() =>
    census(gapReachability([gaps[0] as ArgumentGap], population), classifyGapReachability)
  )
})

test('contract.published-schema-matches-enforced.arguments.control.a-duplicated-gap-reason-halts-as-forbidden-while-distinct-reasons-pass', () => {
  const duplicated: ArgumentGap[] = [
    { address: 'probe_tool.first', reason: 'the exact same blanket reason copied everywhere' },
    { address: 'probe_tool.second', reason: 'the exact same blanket reason copied everywhere' }
  ]
  const items = gapReasonDistinctness(duplicated)
  assert.deepEqual(items.map((item) => item.duplicateOf), [null, 'probe_tool.first'])
  assert.deepEqual(items.map(classifyGapReasonDistinctness), ['allowed', 'forbidden'])
  assert.throws(
    () => census(items, classifyGapReasonDistinctness),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('census rejected a forbidden item') &&
      error.message.includes('probe_tool.second') &&
      !error.message.includes('census halted on an unclassifiable item')
  )
  const distinct: ArgumentGap[] = [
    { address: 'probe_tool.first', reason: 'this address is missing because of reason A' },
    { address: 'probe_tool.second', reason: 'this address is missing because of an unrelated reason B' }
  ]
  assert.doesNotThrow(() => census(gapReasonDistinctness(distinct), classifyGapReasonDistinctness))
})
