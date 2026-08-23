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
  classifyPublishedInput,
  classifyRegistryName,
  listPublishedTools,
  readRegistryCensus,
  registryPopulation,
  type PublishedTool,
  type RegistryCensus
} from '../support/published.ts'
import { CONTROL_SPECS, adaptProbeSpec, spawnProbeServer } from '../support/probe-server.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

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
    published: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population].sort(), ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-all-three-sides', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['real_tool'])
  assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, syntheticCensus)))
})
