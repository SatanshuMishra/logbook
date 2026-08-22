import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { declare } from '../../src/schema/declare.ts'
import type { Declared } from '../../src/schema/declare.ts'
import { resolveNode } from '../../src/schema/example.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import type { Thread } from '../../src/schema/thread.ts'
import { DecisionRecord } from '../../src/schema/decision.ts'
import type { Decision } from '../../src/schema/decision.ts'
import { SessionRecord } from '../../src/schema/session.ts'
import type { SessionEntry } from '../../src/schema/session.ts'

const Person = declare(
  'person',
  z.object({
    name: z.string().min(1).max(8).describe('the person short name'),
    age: z.number().int().min(0).describe('whole years')
  })
)

test('schema.refusal-is-generated', () => {
  const r = Person.parse({ name: 'far too long a name', age: 3 })
  assert.equal(r.ok, false)
  if (r.ok) {
    throw new Error('expected a refusal')
  }
  assert.equal(r.field, 'name')
  assert.match(r.accepted, /8/)
  assert.notEqual(r.example, null)
  assert.notEqual(r.example, '')
  assert.equal(Person.parse({ name: r.example, age: 3 }).ok, true)
  assert.equal(r.retryable, true)
})

type JsonSchemaNode = Record<string, unknown>
type PathSegment = string | number
type MutationCandidate = { path: PathSegment[]; cap: number | null }

const isNode = (value: unknown): value is JsonSchemaNode => typeof value === 'object' && value !== null

const mulberry32 = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pickAt = <T>(items: readonly T[], index: number): T => {
  const item = items[index % items.length]
  if (item === undefined) {
    throw new Error('pickAt indexed past an empty candidate list')
  }
  return item
}

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const cursorTo = (root: Record<string, unknown>, path: PathSegment[]): Record<string, unknown> => {
  let cursor: Record<string, unknown> = root
  for (const segment of path.slice(0, -1)) {
    cursor = cursor[String(segment)] as Record<string, unknown>
  }
  return cursor
}

const deleteAtPath = (record: Record<string, unknown>, path: PathSegment[]): Record<string, unknown> => {
  const clone = deepClone(record)
  const parent = cursorTo(clone, path)
  const lastSegment = path[path.length - 1]
  if (lastSegment === undefined) {
    throw new Error('deleteAtPath requires a non-empty path')
  }
  delete parent[String(lastSegment)]
  return clone
}

const overLengthAtPath = (record: Record<string, unknown>, path: PathSegment[], cap: number): Record<string, unknown> => {
  const clone = deepClone(record)
  const parent = cursorTo(clone, path)
  const lastSegment = path[path.length - 1]
  if (lastSegment === undefined) {
    throw new Error('overLengthAtPath requires a non-empty path')
  }
  parent[String(lastSegment)] = 'x'.repeat(cap + 50)
  return clone
}

const setAtDottedPath = (record: Record<string, unknown>, dotted: string, value: unknown): Record<string, unknown> => {
  if (dotted === '(root)') {
    if (!isNode(value)) {
      throw new Error('a root-level repair must be an object')
    }
    return value as Record<string, unknown>
  }
  const segments = dotted.split('.')
  const clone = deepClone(record)
  const parent = cursorTo(clone, segments)
  const lastSegment = segments[segments.length - 1]
  if (lastSegment === undefined) {
    throw new Error('setAtDottedPath requires a non-empty dotted path')
  }
  parent[lastSegment] = value
  return clone
}

const nodeAtDottedPath = (root: JsonSchemaNode, dotted: string): JsonSchemaNode => {
  if (dotted === '(root)') {
    return root
  }
  let cursor: JsonSchemaNode = root
  for (const segment of dotted.split('.')) {
    const resolved = resolveNode(root, cursor)
    if (/^\d+$/.test(segment)) {
      cursor = isNode(resolved.items) ? resolved.items : resolved
      continue
    }
    const properties = resolved.properties
    if (isNode(properties) && segment in properties) {
      const next = (properties as Record<string, unknown>)[segment]
      cursor = isNode(next) ? next : resolved
      continue
    }
    cursor = resolved
  }
  return cursor
}

const runRefusalExampleProperty = <T extends Record<string, unknown>>(
  declaration: Declared<T>,
  validRecord: T,
  candidates: readonly MutationCandidate[],
  seed: number
): void => {
  const random = mulberry32(seed)
  for (let i = 0; i < 200; i += 1) {
    const candidate = pickAt(candidates, Math.floor(random() * candidates.length))
    const canOverLength = candidate.cap !== null
    const useOverLength = canOverLength && random() < 0.5
    const mutated = useOverLength
      ? overLengthAtPath(validRecord, candidate.path, candidate.cap as number)
      : deleteAtPath(validRecord, candidate.path)

    const result = declaration.parse(mutated)
    assert.equal(result.ok, false, `mutation at ${candidate.path.join('.')} unexpectedly validated`)
    if (result.ok) {
      continue
    }

    const targetNode = nodeAtDottedPath(declaration.jsonSchema, result.field)
    const resolvedTarget = resolveNode(declaration.jsonSchema, targetNode)
    const repairedValue = resolvedTarget.type === 'string' ? result.example : JSON.parse(result.example)
    const repaired = setAtDottedPath(validRecord, result.field, repairedValue)

    const repairedResult = declaration.parse(repaired)
    assert.equal(
      repairedResult.ok,
      true,
      `refusal example for ${result.field} did not re-validate: ${JSON.stringify(repairedResult)}`
    )
  }
}

test('schema.refusal-example-always-revalidates', () => {
  const validThread: Thread = {
    id: '0'.repeat(26),
    slug: 'a',
    title: 'a',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'a',
      next_step: 'a',
      last_session: 'a',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }

  const validDecision: Decision = {
    id: '0'.repeat(26),
    thread_id: '0'.repeat(26),
    title: 'a',
    context: 'a',
    options: [],
    outcome: 'a',
    commit: null,
    supersedes: [],
    created_at: '2024-01-01T00:00:00.000Z'
  }

  const validSession: SessionEntry = {
    id: '0'.repeat(26),
    thread_id: '0'.repeat(26),
    actor: 'a',
    body: 'a',
    created_at: '2024-01-01T00:00:00.000Z'
  }

  runRefusalExampleProperty(
    ThreadRecord,
    validThread,
    [
      { path: ['id'], cap: null },
      { path: ['slug'], cap: 64 },
      { path: ['title'], cap: 200 },
      { path: ['status'], cap: null },
      { path: ['blocked_by'], cap: 500 },
      { path: ['completion_criteria'], cap: null },
      { path: ['spine'], cap: null },
      { path: ['spine', 'active_goal'], cap: 500 },
      { path: ['spine', 'next_step'], cap: 500 },
      { path: ['spine', 'last_session'], cap: 500 },
      { path: ['created_at'], cap: null },
      { path: ['updated_at'], cap: null }
    ],
    1
  )

  runRefusalExampleProperty(
    DecisionRecord,
    validDecision,
    [
      { path: ['id'], cap: null },
      { path: ['thread_id'], cap: null },
      { path: ['title'], cap: 200 },
      { path: ['context'], cap: 4000 },
      { path: ['options'], cap: null },
      { path: ['outcome'], cap: 4000 },
      { path: ['commit'], cap: null },
      { path: ['supersedes'], cap: null },
      { path: ['created_at'], cap: null }
    ],
    2
  )

  runRefusalExampleProperty(
    SessionRecord,
    validSession,
    [
      { path: ['id'], cap: null },
      { path: ['thread_id'], cap: null },
      { path: ['actor'], cap: 100 },
      { path: ['body'], cap: 8000 },
      { path: ['created_at'], cap: null }
    ],
    3
  )
})
