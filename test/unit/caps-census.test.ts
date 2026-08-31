import test from 'node:test'
import assert from 'node:assert/strict'
import { census, type Classified } from '../support/census.ts'
import { synthesise, type JsonSchemaNode } from '../../src/schema/example.ts'
import type { Declared } from '../../src/schema/declare.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import { DecisionRecord } from '../../src/schema/decision.ts'
import { SessionRecord } from '../../src/schema/session.ts'
import { BindingRecord } from '../../src/schema/binding.ts'
import * as caps from '../../src/schema/caps.ts'

type CapRole = 'record-field' | 'call-payload' | 'record-bytes' | 'refusal-display'

const CAP_ROLES: Record<string, CapRole> = {
  THREAD_TITLE_MAX: 'record-field',
  THREAD_SLUG_MAX: 'record-field',
  THREAD_BLOCKED_BY_MAX: 'record-field',
  THREAD_CLOSURE_DETAIL_MAX: 'call-payload',
  BINDING_BRANCH_MAX: 'record-field',
  SPINE_ACTIVE_GOAL_MAX: 'record-field',
  SPINE_NEXT_STEP_MAX: 'record-field',
  SPINE_LAST_SESSION_MAX: 'record-field',
  CRITERIA_MAX_ELEMENTS: 'call-payload',
  OPEN_RISKS_MAX_ELEMENTS: 'call-payload',
  CRITERIA_RETENTION_MAX_ELEMENTS: 'record-field',
  CRITERION_TEXT_MAX: 'record-field',
  CRITERION_CHECK_MAX: 'record-field',
  CRITERION_RESULT_MAX: 'record-field',
  RISK_TEXT_MAX: 'record-field',
  RISK_SCOPE_MAX: 'record-field',
  RISK_REFS_MAX_ELEMENTS: 'record-field',
  RISK_REF_MAX: 'record-field',
  KEY_DECISIONS_MAX_ELEMENTS: 'record-field',
  KEY_DECISION_TITLE_MAX: 'record-field',
  KEY_DECISION_SCOPE_MAX: 'record-field',
  OUT_OF_SCOPE_MAX_ELEMENTS: 'record-field',
  OUT_OF_SCOPE_TEXT_MAX: 'record-field',
  ARTIFACT_LABEL_MAX: 'record-field',
  ARTIFACT_POINTER_MAX: 'record-field',
  DECISION_TITLE_MAX: 'record-field',
  DECISION_CONTEXT_MAX: 'record-field',
  DECISION_OUTCOME_MAX: 'record-field',
  DECISION_OPTIONS_MAX_ELEMENTS: 'record-field',
  DECISION_OPTION_MAX: 'record-field',
  DECISION_SUPERSEDES_MAX_ELEMENTS: 'record-field',
  DECISION_COMMIT_MAX: 'record-field',
  SESSION_ACTOR_MAX: 'record-field',
  SESSION_BODY_MAX: 'record-field',
  THREAD_RECORD_SERIALISED_MAX_BYTES: 'record-bytes',
  UNRECOGNIZED_KEYS_SHOWN_MAX: 'refusal-display',
  UNRECOGNIZED_KEY_NAME_MAX: 'refusal-display',
  UNPARSEABLE_RECORDS_SHOWN_MAX: 'refusal-display',
  UNPARSEABLE_RECORD_NAME_MAX: 'refusal-display'
}

export const classifyCapConstant = (name: string): Classified<string>['verdict'] | 'unclassifiable' =>
  CAP_ROLES[name] === undefined ? 'unclassifiable' : 'allowed'

test('caps-census.every-cap-constant-declares-the-role-it-plays', () => {
  const names = Object.keys(caps)
  assert.ok(
    names.length > 0,
    'caps-census: src/schema/caps.ts exported nothing; a census over an empty list proves nothing'
  )
  assert.doesNotThrow(() => census(names, classifyCapConstant))
  for (const declaredName of Object.keys(CAP_ROLES)) {
    assert.ok(
      names.includes(declaredName),
      `caps-census: CAP_ROLES names ${declaredName}, which src/schema/caps.ts no longer exports`
    )
  }
})

test('caps-census.control.an-unclassified-cap-halts-the-census', () => {
  assert.equal(classifyCapConstant('A_BRAND_NEW_MAX'), 'unclassifiable')
  assert.equal(classifyCapConstant('THREAD_TITLE_MAX'), 'allowed')
})

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
