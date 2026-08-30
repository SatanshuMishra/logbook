import test from 'node:test'
import assert from 'node:assert/strict'
import { census, type Classified } from '../support/census.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { DecisionRecord } from '../../src/schema/decision.ts'
import { SessionRecord } from '../../src/schema/session.ts'
import { BindingRecord } from '../../src/schema/binding.ts'
import { POINTER_PATTERN } from '../../src/schema/field-class.ts'

type SchemaNode = { path: string; value: unknown }

const FIELD_CLASSES = ['structural', 'pointer', 'content'] as const

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

export const classifyFieldClassNode = (entry: SchemaNode): Classified<SchemaNode>['verdict'] | 'unclassifiable' => {
  if (!isPlainObject(entry.value)) return 'unclassifiable'
  if ('$ref' in entry.value) return 'unclassifiable'
  const declared = entry.value.class
  if (declared === undefined) return 'forbidden'
  if (typeof declared !== 'string') return 'unclassifiable'
  return (FIELD_CLASSES as readonly string[]).includes(declared) ? 'allowed' : 'unclassifiable'
}

const RECORDS = [ThreadRecord, DecisionRecord, SessionRecord, BindingRecord]

const allNodes = (): SchemaNode[] => RECORDS.flatMap((record) => flattenSchemaNodes(record.jsonSchema, record.name))

test('field-class.every-record-field-declares-a-class', () => {
  const nodes = allNodes()
  assert.ok(
    nodes.length > 0,
    'field-class: the four record schemas flattened to no nodes; a census over an empty list proves nothing'
  )
  assert.doesNotThrow(() => census(nodes, classifyFieldClassNode))
})

test('field-class.an-array-and-its-element-declare-the-same-class', () => {
  const byPath = new Map(allNodes().map((node) => [node.path, node.value] as const))
  const elementPaths = [...byPath.keys()].filter((path) => path.endsWith('[]'))
  assert.ok(elementPaths.length > 0, 'field-class: no array element nodes were emitted; the pairing assertion proves nothing')
  for (const elementPath of elementPaths) {
    const arrayPath = elementPath.slice(0, -2)
    const arrayNode = byPath.get(arrayPath)
    const elementNode = byPath.get(elementPath)
    assert.ok(isPlainObject(arrayNode), `field-class: ${arrayPath} is not a plain object`)
    assert.ok(isPlainObject(elementNode), `field-class: ${elementPath} is not a plain object`)
    assert.equal(
      elementNode.class,
      arrayNode.class,
      `field-class: ${arrayPath} declares ${String(arrayNode.class)} but ${elementPath} declares ${String(elementNode.class)}`
    )
  }
})

test('field-class.every-declared-pointer-carries-the-pointer-pattern', () => {
  const pointers = allNodes().filter((node) => isPlainObject(node.value) && node.value.class === 'pointer')
  assert.ok(pointers.length > 0, 'field-class: no pointer-class node was emitted; the pattern assertion proves nothing')
  for (const node of pointers) {
    const value = node.value as Record<string, unknown>
    if (value.type !== 'string') continue
    assert.ok(
      typeof value.pattern === 'string' && value.pattern.length > 0,
      `field-class: ${node.path} declares class pointer but carries no pattern`
    )
  }
})

test('field-class.control.an-undeclared-node-is-forbidden-and-a-foreign-class-halts', () => {
  assert.equal(classifyFieldClassNode({ path: 'probe.undeclared', value: { type: 'string' } }), 'forbidden')
  assert.equal(classifyFieldClassNode({ path: 'probe.foreign', value: { type: 'string', class: 'metadata' } }), 'unclassifiable')
  assert.equal(classifyFieldClassNode({ path: 'probe.ref', value: { $ref: '#/$defs/probe' } }), 'unclassifiable')
  assert.equal(classifyFieldClassNode({ path: 'probe.notObject', value: 'string' }), 'unclassifiable')
  assert.equal(classifyFieldClassNode({ path: 'probe.ok', value: { type: 'string', class: 'content' } }), 'allowed')
})

test('field-class.pointer-pattern-refuses-content-and-accepts-an-address', () => {
  for (const forbidden of [
    'docs/spec.md\nsecond line',
    'see ```ts for the shape',
    '@@ -1,2 +1,2 @@',
    '+++ b/file.ts',
    '--- a/file.ts',
    'left U+000A behind'
  ]) {
    assert.equal(POINTER_PATTERN.test(forbidden), false, `POINTER_PATTERN must refuse ${JSON.stringify(forbidden)}`)
  }
  for (const accepted of [
    'docs/specs/2026-08-28-continuity-goal-model.md#L120',
    'src/schema/thread.ts:44',
    'https://example.invalid/a/b',
    '0'.repeat(40)
  ]) {
    assert.equal(POINTER_PATTERN.test(accepted), true, `POINTER_PATTERN must accept ${JSON.stringify(accepted)}`)
  }
})
