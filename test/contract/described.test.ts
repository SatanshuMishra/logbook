import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { z } from 'zod'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { declare } from '../../src/schema/declare.ts'
import { census } from '../support/census.ts'
import { flattenSchemaNodes, isPlainObject, nullableScalarMemberOf, type SchemaNode } from '../support/schema-nodes.ts'
import { listPublishedTools, type Verdict } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const MINIMUM_DESCRIPTION_LENGTH = 10

const UNWALKED_SUBSCHEMA_KEYS = ['anyOf', 'oneOf', 'allOf', '$defs', '$ref'] as const

const carriesUnwalkedSubschema = (node: Record<string, unknown>): boolean => {
  if (UNWALKED_SUBSCHEMA_KEYS.some((key) => key in node)) return true
  return isPlainObject(node.additionalProperties)
}

export const classifyDescribedNode = (entry: SchemaNode): Verdict => {
  if (!isPlainObject(entry.value)) return 'unclassifiable'
  if (nullableScalarMemberOf(entry.value) === undefined && carriesUnwalkedSubschema(entry.value)) return 'unclassifiable'
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

test('contract.every-property-described.control.a-nullable-scalar-is-described-by-its-own-description', () => {
  const describedNullable: SchemaNode = {
    path: 'probe.nullableField',
    value: { anyOf: [{ type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' }, { type: 'null' }], description: 'a criterion id, or null for the whole thread' }
  }
  assert.equal(classifyDescribedNode(describedNullable), 'allowed')

  const undescribedNullable: SchemaNode = {
    path: 'probe.undescribedNullableField',
    value: { anyOf: [{ type: 'string' }, { type: 'null' }] }
  }
  assert.equal(classifyDescribedNode(undescribedNullable), 'forbidden')

  const nullableObject: SchemaNode = {
    path: 'probe.nullableObjectField',
    value: {
      anyOf: [{ type: 'object', properties: { inner: { type: 'string' } } }, { type: 'null' }],
      description: 'an object whose inner properties no walker reaches'
    }
  }
  assert.equal(classifyDescribedNode(nullableObject), 'unclassifiable')

  for (const [key, subschema] of [
    ['$ref', '#/$defs/elsewhere'],
    ['$defs', { elsewhere: { type: 'object', properties: { inner: { type: 'string' } } } }],
    ['additionalProperties', { type: 'string' }],
    ['properties', { inner: { type: 'string' } }],
    ['items', { type: 'string' }],
    ['oneOf', [{ type: 'string' }, { type: 'integer' }]],
    ['allOf', [{ type: 'string' }]],
    ['type', 'string']
  ] as const) {
    const nullableBesideSubschema: SchemaNode = {
      path: `probe.nullableBeside${key}`,
      value: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        [key]: subschema,
        description: 'a nullable string sitting beside another schema keyword'
      }
    }
    assert.equal(
      classifyDescribedNode(nullableBesideSubschema),
      'unclassifiable',
      `a nullable anyOf must not vouch for a node that also carries ${key}`
    )
  }
})
