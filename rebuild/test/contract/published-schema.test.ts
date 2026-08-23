import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ALL_TOOLS, registerTool } from '../../src/server/register.ts'
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
import { CONTROL_SPECS, spawnProbeServer } from '../support/probe-server.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

type CensusItem = { name: string; inputSchema: Record<string, unknown>; enforcedKeys: readonly string[] }

const classifyCensusItem = (item: CensusItem): ReturnType<typeof classifyPublishedInput> =>
  classifyPublishedInput(item.inputSchema, item.enforcedKeys)

const soleTool = (tools: PublishedTool[], name: string): PublishedTool => {
  const found = tools.find((tool) => tool.name === name)
  if (found === undefined) {
    throw new Error(`expected a published tool named "${name}", found: ${tools.map((t) => t.name).join(', ')}`)
  }
  return found
}

test('contract.published-schema-matches-enforced.production-registry-is-vacuous-but-real', async () => {
  assert.equal(ALL_TOOLS.length, 0)
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const published = await listPublishedTools(spawned)
    assert.equal(published.length, 0)
    const items: CensusItem[] = published.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
      enforcedKeys: []
    }))
    assert.doesNotThrow(() => census(items, classifyCensusItem))
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.production-registry-census-is-vacuous-but-real', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const registryCensus = await readRegistryCensus(spawned)
    assert.deepEqual(registryCensus.files, [])
    assert.deepEqual(registryCensus.registered, [])
    assert.deepEqual(registryCensus.published, [])
    const population = registryPopulation(registryCensus)
    assert.equal(population.length, 0)
    assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, registryCensus)))
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

test('contract.published-schema-matches-enforced.control.nullable-root-is-forbidden', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.nullableRoot])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_nullable_root')
    assert.deepEqual(tool.inputSchema.properties, {})
    const verdict = classifyPublishedInput(tool.inputSchema, ['a'])
    assert.equal(verdict, 'forbidden')
    assert.throws(
      () => census([{ name: tool.name, inputSchema: tool.inputSchema, enforcedKeys: ['a'] }], classifyCensusItem),
      (error: unknown) => error instanceof Error && error.message.includes('probe_nullable_root')
    )
  } finally {
    await spawned.close()
  }
})

test('contract.published-schema-matches-enforced.control.union-root-is-forbidden', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.unionRoot])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_union_root')
    assert.deepEqual(tool.inputSchema.properties, {})
    const verdict = classifyPublishedInput(tool.inputSchema, ['a'])
    assert.equal(verdict, 'forbidden')
    assert.throws(
      () => census([{ name: tool.name, inputSchema: tool.inputSchema, enforcedKeys: ['a'] }], classifyCensusItem),
      (error: unknown) => error instanceof Error && error.message.includes('probe_union_root')
    )
  } finally {
    await spawned.close()
  }
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
