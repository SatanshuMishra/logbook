import test from 'node:test'
import assert from 'node:assert/strict'
import { synthesise, type JsonSchemaNode } from '../../src/schema/example.ts'
import type { Declared } from '../../src/schema/declare.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { DecisionRecord } from '../../src/schema/decision.ts'
import { SessionRecord } from '../../src/schema/session.ts'
import { BindingRecord } from '../../src/schema/binding.ts'

type CappedNode = {
  record: Declared<unknown>
  path: (string | number)[]
  label: string
  limit: number
  kind: 'string' | 'array'
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const collectCappedNodes = (record: Declared<unknown>): CappedNode[] => {
  const found: CappedNode[] = []
  const visit = (raw: unknown, path: (string | number)[]): void => {
    if (!isPlainObject(raw)) return
    const members = Array.isArray(raw.anyOf) ? raw.anyOf : [raw]
    for (const member of members) {
      if (!isPlainObject(member)) continue
      const merged = { ...raw, ...member }
      const label = `${record.name}.${path.join('.')}`
      if (typeof merged.maxLength === 'number') {
        found.push({ record, path, label, limit: merged.maxLength, kind: 'string' })
      }
      if (typeof merged.maxItems === 'number') {
        found.push({ record, path, label, limit: merged.maxItems, kind: 'array' })
      }
      if (isPlainObject(merged.properties)) {
        for (const [key, child] of Object.entries(merged.properties)) visit(child, [...path, key])
      }
      if (merged.items !== undefined) visit(merged.items, [...path, 0])
    }
  }
  visit(record.jsonSchema, [])
  return found
}

const nodeAt = (root: JsonSchemaNode, path: (string | number)[]): JsonSchemaNode => {
  let cursor: JsonSchemaNode = root
  for (const segment of path) {
    const members = Array.isArray(cursor.anyOf) ? (cursor.anyOf as unknown[]) : [cursor]
    const merged = members.filter(isPlainObject).reduce<Record<string, unknown>>((acc, m) => ({ ...acc, ...m }), {})
    const next =
      typeof segment === 'number'
        ? merged.items
        : isPlainObject(merged.properties)
          ? (merged.properties as Record<string, unknown>)[segment]
          : undefined
    if (!isPlainObject(next)) return cursor
    cursor = next
  }
  return cursor
}

const setAtPath = (
  root: JsonSchemaNode,
  base: unknown,
  path: (string | number)[],
  walked: (string | number)[],
  value: unknown
): unknown => {
  if (path.length === 0) return value
  const [head, ...rest] = path as [string | number, ...(string | number)[]]
  const here = [...walked, head]
  if (typeof head === 'number') {
    const list = Array.isArray(base) ? [...base] : []
    const seeded = list[head] ?? synthesise(root, nodeAt(root, here))
    list[head] = setAtPath(root, seeded, rest, here, value)
    return list
  }
  const object = isPlainObject(base) ? { ...base } : {}
  const seeded = object[head] ?? synthesise(root, nodeAt(root, here))
  object[head] = setAtPath(root, seeded, rest, here, value)
  return object
}

const overCapValue = (root: JsonSchemaNode, node: CappedNode): unknown => {
  if (node.kind === 'string') return 'x'.repeat(node.limit + 1)
  return Array.from({ length: node.limit + 1 }, () => synthesise(root, nodeAt(root, [...node.path, 0])))
}

const RECORDS: Declared<unknown>[] = [
  ThreadRecord as unknown as Declared<unknown>,
  DecisionRecord as unknown as Declared<unknown>,
  SessionRecord as unknown as Declared<unknown>,
  BindingRecord as unknown as Declared<unknown>
]

test('caps-census.every-capped-record-field-refuses-with-field-limit-observed-and-remedy', () => {
  const nodes = RECORDS.flatMap(collectCappedNodes)
  assert.ok(
    nodes.length > 0,
    'caps-census: no capped record field was discovered; a census over an empty list proves nothing'
  )

  for (const node of nodes) {
    const root = node.record.jsonSchema as JsonSchemaNode
    const candidate = setAtPath(root, synthesise(root, root), node.path, [], overCapValue(root, node))
    const parsed = node.record.parse(candidate)

    assert.equal(parsed.ok, false, `caps-census: ${node.label} accepted a value one over its cap of ${node.limit}`)
    if (parsed.ok) continue
    assert.equal(parsed.field, node.path.join('.'), `caps-census: ${node.label} refused but named field ${parsed.field}`)
    assert.match(parsed.message, new RegExp(String(node.limit)), `caps-census: ${node.label} refusal omits its limit`)
    assert.match(
      parsed.message,
      /observed \d+ (characters|entries)/,
      `caps-census: ${node.label} refusal omits the observed value`
    )
    assert.match(parsed.message, /remedy: /, `caps-census: ${node.label} refusal omits a remedy`)
    assert.equal(parsed.retryable, true, `caps-census: ${node.label} refusal must be retryable`)
  }
})
