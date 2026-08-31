import assert from 'node:assert/strict'
import { test } from 'node:test'
import { census, type Classified } from '../support/census.ts'
import type { Declared } from '../../src/schema/declare.ts'
import { flattenSchemaNodes, isPlainObject, type SchemaNode } from '../support/schema-nodes.ts'
import { ISO_PATTERN, SHA_PATTERN, SLUG_PATTERN, ULID_PATTERN } from '../../src/schema/ids.ts'
import { POINTER_PATTERN } from '../../src/schema/field-class.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { BindingRecord } from '../../src/schema/binding.ts'
import {
  renderDecisionResource,
  renderSessionEntryResource,
  renderThreadDetail
} from '../../src/server/resource-render.ts'

const FIELD_CLASSES: readonly string[] = ['structural', 'pointer', 'content']

const sentinelFor = (index: number): string => `zq-${String(index).padStart(3, '0')}-sentinel`

const halt = (path: string, detail: string): never => {
  throw new Error(`content-rendered: ${path} ${detail}`)
}

const nonNullBranch = (node: Record<string, unknown>, path: string): Record<string, unknown> => {
  const anyOf = node.anyOf
  if (anyOf === undefined) return node
  if (!Array.isArray(anyOf)) return halt(path, 'carries an anyOf that is not an array')
  const members = anyOf.filter(isPlainObject).filter((member) => member.type !== 'null')
  const only = members[0]
  if (members.length !== 1 || only === undefined) {
    return halt(path, `carries an anyOf with ${members.length} non-null members; the sweep resolves exactly one`)
  }
  return only
}

const placeholderFor = (node: Record<string, unknown>, path: string): string => {
  const pattern = node.pattern
  if (pattern === undefined) {
    const minLength = typeof node.minLength === 'number' ? node.minLength : 1
    return 'x'.repeat(Math.max(minLength, 1))
  }
  if (pattern === ULID_PATTERN.source) return '0'.repeat(26)
  if (pattern === SLUG_PATTERN.source) return 'a'
  if (pattern === ISO_PATTERN.source) return '2024-01-01T00:00:00.000Z'
  if (pattern === SHA_PATTERN.source) return '0'.repeat(40)
  if (pattern === POINTER_PATTERN.source) return 'docs/example.md'
  return halt(path, `carries pattern ${String(pattern)}, which the sweep cannot synthesise a value for`)
}

const sentinelValueFor = (node: Record<string, unknown>, path: string, sentinel: string): string => {
  const maxLength = node.maxLength
  if (typeof maxLength === 'number' && maxLength < sentinel.length) {
    return halt(path, `caps at ${maxLength} characters, shorter than the ${sentinel.length}-character sentinel`)
  }
  const pattern = node.pattern
  if (pattern === undefined) return sentinel
  if (pattern === SLUG_PATTERN.source) return sentinel
  if (pattern === POINTER_PATTERN.source) return sentinel
  return halt(path, `is class content and carries pattern ${String(pattern)}, which the sentinel does not satisfy`)
}

const buildValue = (node: unknown, path: string, sentinels: ReadonlyMap<string, string>): unknown => {
  if (!isPlainObject(node)) return halt(path, 'is not a plain-object schema node')
  if ('$ref' in node) return halt(path, 'carries a $ref the sweep does not follow')
  const resolved = nonNullBranch(node, path)
  const enumValues = resolved.enum
  if (Array.isArray(enumValues)) {
    const first = enumValues[0]
    if (first === undefined) return halt(path, 'declares an empty enum')
    return first
  }
  const type = resolved.type
  if (type === 'string') {
    const sentinel = sentinels.get(path)
    return sentinel === undefined ? placeholderFor(resolved, path) : sentinelValueFor(resolved, path, sentinel)
  }
  if (type === 'integer' || type === 'number') {
    return typeof resolved.minimum === 'number' ? resolved.minimum : 1
  }
  if (type === 'boolean') return true
  if (type === 'array') return [buildValue(resolved.items, `${path}[]`, sentinels)]
  if (type === 'object') {
    const properties = resolved.properties
    if (!isPlainObject(properties)) return halt(path, 'is an object node with no properties map')
    const built: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(properties)) {
      built[key] = buildValue(child, `${path}.${key}`, sentinels)
    }
    return built
  }
  return halt(path, `has type ${String(type)}, which the sweep cannot synthesise`)
}

const classOf = (node: SchemaNode): string | undefined => {
  if (!isPlainObject(node.value)) return undefined
  const declared = node.value.class
  return typeof declared === 'string' ? declared : undefined
}

const isStringNode = (node: SchemaNode): boolean => {
  if (!isPlainObject(node.value)) return false
  if ('$ref' in node.value) return false
  const resolved = nonNullBranch(node.value, node.path)
  return resolved.type === 'string' && !Array.isArray(resolved.enum)
}

const RECORDS = [ThreadRecord, DecisionRecord, SessionRecord, BindingRecord] as const

const allNodes = (): SchemaNode[] =>
  RECORDS.flatMap((record) => flattenSchemaNodes(record.jsonSchema, record.name))

const sentinelMap = (nodes: readonly SchemaNode[]): Map<string, string> => {
  const map = new Map<string, string>()
  let index = 0
  for (const node of nodes) {
    if (classOf(node) !== 'content') continue
    if (!isStringNode(node)) continue
    map.set(node.path, sentinelFor(index))
    index += 1
  }
  return map
}

const parsedOr = <T>(declared: Declared<T>, built: unknown): T => {
  const parsed = declared.parse(built)
  assert.ok(
    parsed.ok,
    `content-rendered: the synthesised ${declared.name} record did not parse: ${parsed.ok ? '' : parsed.message}`
  )
  return parsed.value
}

const renderedSurfaces = (sentinels: ReadonlyMap<string, string>): string => {
  const thread = parsedOr<Thread>(ThreadRecord, buildValue(ThreadRecord.jsonSchema, 'thread', sentinels))
  const decision = parsedOr<Decision>(DecisionRecord, buildValue(DecisionRecord.jsonSchema, 'decision', sentinels))
  const entry = parsedOr<SessionEntry>(SessionRecord, buildValue(SessionRecord.jsonSchema, 'session', sentinels))
  parsedOr(BindingRecord, buildValue(BindingRecord.jsonSchema, 'binding', sentinels))

  return [
    renderThreadDetail(thread, { resolved: 0, dangling: [], quarantined: [] }, null, null),
    renderDecisionResource(decision),
    renderSessionEntryResource(entry)
  ].join('\n')
}

const classify = (
  node: SchemaNode,
  sentinels: ReadonlyMap<string, string>,
  rendered: string
): Classified<SchemaNode>['verdict'] | 'unclassifiable' => {
  if (!isPlainObject(node.value)) return 'unclassifiable'
  if ('$ref' in node.value) return 'unclassifiable'
  const declared = node.value.class
  if (declared === undefined) return 'forbidden'
  if (typeof declared !== 'string') return 'unclassifiable'
  if (!FIELD_CLASSES.includes(declared)) return 'unclassifiable'
  if (declared !== 'content') return 'allowed'
  const own = sentinels.get(node.path)
  if (own !== undefined) return rendered.includes(own) ? 'allowed' : 'forbidden'
  const element = sentinels.get(`${node.path}[]`)
  if (element === undefined) return 'unclassifiable'
  return rendered.includes(element) ? 'allowed' : 'forbidden'
}

const report = (nodes: readonly SchemaNode[], sentinels: ReadonlyMap<string, string>, rendered: string): string => {
  const unrendered = nodes.filter((node) => classify(node, sentinels, rendered) !== 'allowed').map((node) => node.path)
  return [`content-rendered: ${unrendered.length} of ${nodes.length} record schema nodes are not allowed`, ...unrendered].join('\n')
}

test('content.every-content-field-reaches-a-rendered-surface', () => {
  const nodes = allNodes()
  assert.ok(nodes.length > 0, 'content-rendered: the four record schemas flattened to no nodes')
  const sentinels = sentinelMap(nodes)
  assert.ok(sentinels.size > 0, 'content-rendered: no content-class string field was found')
  const rendered = renderedSurfaces(sentinels)
  assert.doesNotThrow(
    () => census(nodes, (node) => classify(node, sentinels, rendered)),
    report(nodes, sentinels, rendered)
  )
})

test('content.every-content-field-reaches-a-rendered-surface.control.halts-on-an-unrendered-or-undeclared-field', () => {
  const probeSentinel = sentinelFor(999)
  const sentinels = new Map([['probe.unrendered', probeSentinel]])
  const emptySurface = 'a surface that renders nothing'
  const unrendered: SchemaNode = { path: 'probe.unrendered', value: { type: 'string', class: 'content' } }

  assert.equal(classify(unrendered, sentinels, emptySurface), 'forbidden')
  assert.throws(() => census([unrendered], (node) => classify(node, sentinels, emptySurface)))
  assert.equal(classify(unrendered, sentinels, `it says ${probeSentinel} here`), 'allowed')

  assert.equal(
    classify({ path: 'probe.undeclared', value: { type: 'string' } }, sentinels, emptySurface),
    'forbidden'
  )
  assert.equal(
    classify({ path: 'probe.wrong-class', value: { type: 'string', class: 'wire' } }, sentinels, emptySurface),
    'unclassifiable'
  )
  assert.equal(
    classify({ path: 'probe.referenced', value: { $ref: '#/$defs/probe' } }, sentinels, emptySurface),
    'unclassifiable'
  )
  assert.equal(classify({ path: 'probe.scalar', value: 'string' }, sentinels, emptySurface), 'unclassifiable')
})

test('content.every-content-field-reaches-a-rendered-surface.control.the-builder-halts-on-what-it-cannot-synthesise', () => {
  assert.throws(
    () => buildValue({ type: 'string', pattern: '^probe$' }, 'probe.exotic', new Map()),
    /content-rendered: probe\.exotic carries pattern \^probe\$/
  )
  assert.throws(
    () => buildValue({ type: 'tuple' }, 'probe.exotic-type', new Map()),
    /content-rendered: probe\.exotic-type has type tuple/
  )
  assert.throws(
    () => buildValue({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 'probe.two-branches', new Map()),
    /content-rendered: probe\.two-branches carries an anyOf with 2 non-null members/
  )
})
