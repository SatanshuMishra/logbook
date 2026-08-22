import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { ULID_PATTERN } from '../../src/schema/ids.ts'
import { census } from '../support/census.ts'

type JsonSchemaNode = Record<string, unknown>

const isNode = (value: unknown): value is JsonSchemaNode => typeof value === 'object' && value !== null

const collectArrayOfObjectNodes = (root: JsonSchemaNode): JsonSchemaNode[] => {
  const found: JsonSchemaNode[] = []
  const visited = new Set<JsonSchemaNode>()

  const visit = (node: unknown): void => {
    if (!isNode(node) || visited.has(node)) {
      return
    }
    visited.add(node)

    if (node.type === 'array' && isNode(node.items)) {
      if (node.items.type === 'object') {
        found.push(node)
      }
      visit(node.items)
    }

    if (isNode(node.properties)) {
      for (const value of Object.values(node.properties)) {
        visit(value)
      }
    }

    if (Array.isArray(node.anyOf)) {
      for (const member of node.anyOf) {
        visit(member)
      }
    }
  }

  visit(root)
  return found
}

test('model.every-element-has-id', () => {
  const arrayOfObjectNodes = collectArrayOfObjectNodes(ThreadRecord.jsonSchema)
  assert.ok(arrayOfObjectNodes.length > 0)

  census(arrayOfObjectNodes, (node) => {
    const items = node.items
    if (!isNode(items)) {
      return 'unclassifiable'
    }
    const required = items.required
    const properties = items.properties
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
