import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { z } from 'zod'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { declare } from '../../src/schema/declare.ts'
import { census } from '../support/census.ts'
import { listPublishedTools, type Verdict } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const MINIMUM_DESCRIPTION_LENGTH = 10

type SchemaNode = { path: string; value: unknown }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const flattenSchemaNodes = (value: unknown, path: string): SchemaNode[] => {
  if (!isPlainObject(value)) return []

  const collected: SchemaNode[] = []

  const properties = value.properties
  if (properties !== undefined) {
    if (!isPlainObject(properties)) {
      collected.push({ path: `${path}.properties`, value: properties })
    } else {
      for (const [key, child] of Object.entries(properties)) {
        const childPath = `${path}.${key}`
        collected.push({ path: childPath, value: child })
        collected.push(...flattenSchemaNodes(child, childPath))
      }
    }
  }

  const items = value.items
  if (items !== undefined) {
    const itemsPath = `${path}[]`
    collected.push({ path: itemsPath, value: items })
    collected.push(...flattenSchemaNodes(items, itemsPath))
  }

  return collected
}

const UNWALKED_SUBSCHEMA_KEYS = ['anyOf', 'oneOf', 'allOf', '$defs', '$ref'] as const

const carriesUnwalkedSubschema = (node: Record<string, unknown>): boolean => {
  if (UNWALKED_SUBSCHEMA_KEYS.some((key) => key in node)) return true
  return isPlainObject(node.additionalProperties)
}

export const classifyDescribedNode = (entry: SchemaNode): Verdict => {
  if (!isPlainObject(entry.value)) return 'unclassifiable'
  if (carriesUnwalkedSubschema(entry.value)) return 'unclassifiable'
  const description = entry.value.description
  if (description === undefined) return 'forbidden'
  if (typeof description !== 'string') return 'unclassifiable'
  return description.trim().length >= MINIMUM_DESCRIPTION_LENGTH ? 'allowed' : 'forbidden'
}

test('contract.every-property-described', async () => {
  assert.ok(
    ALL_TOOLS.length > 0,
    `contract.every-property-described: ALL_TOOLS is empty (${ALL_TOOLS.length} registered tools); a census over an empty list proves nothing`
  )

  const localItems = ALL_TOOLS.flatMap((spec) =>
    flattenSchemaNodes(declare(spec.name, spec.input as unknown as z.ZodType).jsonSchema, spec.name)
  )
  assert.doesNotThrow(() => census(localItems, classifyDescribedNode))

  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    await spawned.client.listTools()
    const published = await listPublishedTools(spawned)

    const publishedNames = published.map((tool) => tool.name).slice().sort()
    const registeredNames = ALL_TOOLS.map((tool) => tool.name).slice().sort()
    assert.deepEqual(
      publishedNames,
      registeredNames,
      'contract.every-property-described: published tool names must equal ALL_TOOLS names'
    )

    const publishedItems = published.flatMap((tool) => flattenSchemaNodes(tool.inputSchema, tool.name))
    assert.doesNotThrow(() => census(publishedItems, classifyDescribedNode))
  } finally {
    await spawned.close()
  }
})

test('contract.every-property-described.control.unwalked-subschema-halts', () => {
  const anyOfNode: SchemaNode = { path: 'probe.anyOfField', value: { anyOf: [{ type: 'string' }, { type: 'number' }] } }
  assert.equal(classifyDescribedNode(anyOfNode), 'unclassifiable')

  const refNode: SchemaNode = { path: 'probe.refField', value: { $ref: '#/$defs/probe' } }
  assert.equal(classifyDescribedNode(refNode), 'unclassifiable')

  const schemaAdditionalPropertiesNode: SchemaNode = {
    path: 'probe.additionalPropertiesField',
    value: { type: 'object', additionalProperties: { type: 'string' } }
  }
  assert.equal(classifyDescribedNode(schemaAdditionalPropertiesNode), 'unclassifiable')

  const booleanAdditionalPropertiesNode: SchemaNode = {
    path: 'probe.strictObjectField',
    value: { type: 'object', additionalProperties: false, description: 'a strict object field' }
  }
  assert.equal(classifyDescribedNode(booleanAdditionalPropertiesNode), 'allowed')
})
