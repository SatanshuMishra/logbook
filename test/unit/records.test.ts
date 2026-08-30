import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { ULID_PATTERN } from '../../src/schema/ids.ts'
import { resolveNode } from '../../src/schema/example.ts'
import { census } from '../support/census.ts'

type JsonSchemaNode = Record<string, unknown>
type FoundCollection = { path: string; node: JsonSchemaNode }

const isNode = (value: unknown): value is JsonSchemaNode => typeof value === 'object' && value !== null

const EXPECTED_COLLECTION_PATHS = ['artifacts', 'completion_criteria', 'spine.key_decisions', 'spine.open_risks', 'spine.out_of_scope']

const collectArrayOfObjectNodes = (root: JsonSchemaNode): FoundCollection[] => {
  const found: FoundCollection[] = []
  const visited = new Set<JsonSchemaNode>()

  const visit = (rawNode: unknown, path: string): void => {
    if (!isNode(rawNode)) {
      return
    }
    const node = resolveNode(root, rawNode)
    if (visited.has(node)) {
      return
    }
    visited.add(node)

    if (node.type === 'array' && isNode(node.items)) {
      const items = resolveNode(root, node.items)
      if (items.type === 'object') {
        found.push({ path, node })
      }
      visit(node.items, `${path}[]`)
    }

    if (isNode(node.properties)) {
      for (const [key, value] of Object.entries(node.properties)) {
        visit(value, path === '' ? key : `${path}.${key}`)
      }
    }

    if (Array.isArray(node.anyOf)) {
      for (const member of node.anyOf) {
        visit(member, path)
      }
    }
  }

  visit(root, '')
  return found
}

test('model.every-element-has-id', () => {
  const arrayOfObjectNodes = collectArrayOfObjectNodes(ThreadRecord.jsonSchema)
  const discoveredPaths = arrayOfObjectNodes.map((found) => found.path).sort()
  assert.deepStrictEqual(discoveredPaths, EXPECTED_COLLECTION_PATHS)

  census(arrayOfObjectNodes, ({ node }) => {
    const items = node.items
    if (!isNode(items)) {
      return 'unclassifiable'
    }
    const resolvedItems = resolveNode(ThreadRecord.jsonSchema, items)
    const required = resolvedItems.required
    const properties = resolvedItems.properties
    if (!Array.isArray(required) || !isNode(properties)) {
      return 'unclassifiable'
    }
    if (!required.includes('id')) {
      return 'forbidden'
    }
    const idNode = properties.id
    if (!isNode(idNode) || typeof idNode.pattern !== 'string') {
      return 'unclassifiable'
    }
    return idNode.pattern === ULID_PATTERN.source ? 'allowed' : 'forbidden'
  })
})

test('model.every-element-has-id.census-is-exhaustive-not-just-non-empty', () => {
  const mutated = JSON.parse(JSON.stringify(ThreadRecord.jsonSchema)) as JsonSchemaNode
  const properties = mutated.properties as Record<string, JsonSchemaNode>
  const spine = properties.spine as JsonSchemaNode
  const spineProperties = spine.properties as Record<string, JsonSchemaNode>
  delete spineProperties.key_decisions

  const found = collectArrayOfObjectNodes(mutated)
  const discoveredPaths = found.map((entry) => entry.path).sort()

  assert.ok(discoveredPaths.length > 0)
  assert.notDeepStrictEqual(discoveredPaths, EXPECTED_COLLECTION_PATHS)
  assert.deepStrictEqual(discoveredPaths, ['artifacts', 'completion_criteria', 'spine.open_risks', 'spine.out_of_scope'])
})

test('model.every-element-has-id.follows-shared-refs', () => {
  const Shared = z.object({
    id: z.string().regex(ULID_PATTERN),
    text: z.string()
  })
  const Outer = z.object({
    firstCollection: z.array(Shared),
    secondCollection: z.array(Shared)
  })
  const refSchema = z.toJSONSchema(Outer, { reused: 'ref' }) as JsonSchemaNode

  assert.ok(JSON.stringify(refSchema).includes('$ref'), 'the synthetic schema must actually exercise $ref for this test to prove anything')

  const found = collectArrayOfObjectNodes(refSchema)
  const discoveredPaths = found.map((entry) => entry.path).sort()

  assert.deepStrictEqual(discoveredPaths, ['firstCollection', 'secondCollection'])
})
