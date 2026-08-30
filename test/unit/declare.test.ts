import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { declare } from '../../src/schema/declare.ts'
import type { Declared } from '../../src/schema/declare.ts'
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

type PathSegment = string | number
type MutationCandidate = { path: PathSegment[]; cap: number | null; optional: boolean }
type ZodAny = z.ZodType<unknown>

const isNode = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

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

const UNACCEPTABLE_VALUE = { unacceptable: true }

const setUnacceptableAtPath = (record: Record<string, unknown>, path: PathSegment[]): Record<string, unknown> => {
  const clone = deepClone(record)
  const parent = cursorTo(clone, path)
  const lastSegment = path[path.length - 1]
  if (lastSegment === undefined) {
    throw new Error('setUnacceptableAtPath requires a non-empty path')
  }
  parent[String(lastSegment)] = UNACCEPTABLE_VALUE
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

const zodDefType = (schema: ZodAny): string => (schema as unknown as { def: { type: string } }).def.type

const zodUnwrap = (schema: ZodAny): ZodAny => {
  const type = zodDefType(schema)
  if (type === 'nullable' || type === 'optional' || type === 'default') {
    return zodUnwrap((schema as unknown as { unwrap: () => ZodAny }).unwrap())
  }
  return schema
}

const zodShape = (schema: ZodAny): Record<string, ZodAny> =>
  (schema as unknown as { shape: Record<string, ZodAny> }).shape

const zodElement = (schema: ZodAny): ZodAny => (schema as unknown as { element: ZodAny }).element

const zodMaxLength = (schema: ZodAny): number | null => {
  const value = (schema as unknown as { maxLength: number | null }).maxLength
  return typeof value === 'number' ? value : null
}

const zodEnumOptions = (schema: ZodAny): unknown[] => (schema as unknown as { options: unknown[] }).options

const isStringLikeZodType = (schema: ZodAny): boolean => {
  const type = zodDefType(schema)
  if (type === 'string') {
    return true
  }
  if (type === 'enum') {
    const options = zodEnumOptions(schema)
    return Array.isArray(options) && options.length > 0 && options.every((value) => typeof value === 'string')
  }
  return false
}

const zodTypeAtDottedPath = (schema: ZodAny, dotted: string): ZodAny => {
  if (dotted === '(root)') {
    return zodUnwrap(schema)
  }
  let cursor = zodUnwrap(schema)
  for (const segment of dotted.split('.')) {
    if (/^\d+$/.test(segment)) {
      cursor = zodUnwrap(zodElement(cursor))
      continue
    }
    const shape = zodShape(cursor)
    const next = shape[segment]
    if (next === undefined) {
      throw new Error(`zodTypeAtDottedPath found no field named "${segment}" while resolving "${dotted}"`)
    }
    cursor = zodUnwrap(next)
  }
  return cursor
}

const deriveCandidates = (schema: ZodAny, sample: unknown, path: PathSegment[]): MutationCandidate[] => {
  const unwrapped = zodUnwrap(schema)
  const type = zodDefType(unwrapped)

  if (type === 'object') {
    const shape = zodShape(unwrapped)
    const record = isNode(sample) ? sample : {}
    return Object.keys(shape).flatMap((key) => {
      const fieldSchema = shape[key]
      if (fieldSchema === undefined) {
        return []
      }
      const fieldPath = [...path, key]
      const fieldUnwrapped = zodUnwrap(fieldSchema)
      const leaf: MutationCandidate = {
        path: fieldPath,
        cap: isStringLikeZodType(fieldUnwrapped) ? zodMaxLength(fieldUnwrapped) : null,
        optional: zodDefType(fieldSchema) === 'optional'
      }
      return [leaf, ...deriveCandidates(fieldSchema, record[key], fieldPath)]
    })
  }

  if (type === 'array') {
    const element = zodElement(unwrapped)
    const elementUnwrapped = zodUnwrap(element)
    if (zodDefType(elementUnwrapped) !== 'object') {
      return []
    }
    const items = Array.isArray(sample) ? sample : []
    const first: unknown = items[0]
    if (first === undefined) {
      throw new Error(
        `deriveCandidates needs a populated sample array at "${path.join('.')}" to reach its array-of-object branch`
      )
    }
    return deriveCandidates(element, first, [...path, 0])
  }

  return []
}

const runRefusalExampleProperty = <T extends Record<string, unknown>>(
  declaration: Declared<T>,
  validRecord: T,
  seed: number
): void => {
  const candidates = deriveCandidates(declaration.schema, validRecord, [])
  assert.ok(candidates.length > 0, `no mutation candidates were derived for ${declaration.name}`)

  const random = mulberry32(seed)
  for (let i = 0; i < 200; i += 1) {
    const candidate = pickAt(candidates, Math.floor(random() * candidates.length))
    const canOverLength = candidate.cap !== null
    const useOverLength = canOverLength && random() < 0.5
    const mutated = useOverLength
      ? overLengthAtPath(validRecord, candidate.path, candidate.cap as number)
      : candidate.optional
        ? setUnacceptableAtPath(validRecord, candidate.path)
        : deleteAtPath(validRecord, candidate.path)

    const result = declaration.parse(mutated)
    assert.equal(result.ok, false, `mutation at ${candidate.path.join('.')} unexpectedly validated`)
    if (result.ok) {
      continue
    }

    const targetType = zodTypeAtDottedPath(declaration.schema, result.field)
    const repairedValue = isStringLikeZodType(targetType) ? result.example : JSON.parse(result.example)
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
    completion_criteria: [
      { id: '0'.repeat(26), ordinal: 1, text: 'a', done: false, kind: 'planned', struck_by: null }
    ],
    artifacts: [{ id: '0'.repeat(26), label: 'a', pointer: 'a' }],
    spine: {
      active_goal: 'a',
      next_step: 'a',
      last_session: 'a',
      open_risks: [{ id: '0'.repeat(26), scope: 'a', text: 'a', refs: ['a'] }],
      key_decisions: [{ id: '0'.repeat(26), decision_id: '0'.repeat(26), title: 'a', scope: 'a' }],
      out_of_scope: [{ id: '0'.repeat(26), text: 'a' }]
    },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }

  const validDecision: Decision = {
    id: '0'.repeat(26),
    thread_id: '0'.repeat(26),
    title: 'a',
    context: 'a',
    options: ['a'],
    outcome: 'a',
    commit: null,
    supersedes: ['0'.repeat(26)],
    created_at: '2024-01-01T00:00:00.000Z'
  }

  const validSession: SessionEntry = {
    id: '0'.repeat(26),
    thread_id: '0'.repeat(26),
    actor: 'a',
    body: 'a',
    created_at: '2024-01-01T00:00:00.000Z'
  }

  runRefusalExampleProperty(ThreadRecord, validThread, 1)
  runRefusalExampleProperty(DecisionRecord, validDecision, 2)
  runRefusalExampleProperty(SessionRecord, validSession, 3)
})

test('schema.refusal-example-property.candidates-reach-nested-and-array-branches', () => {
  const validThread: Thread = {
    id: '0'.repeat(26),
    slug: 'a',
    title: 'a',
    status: 'open',
    blocked_by: null,
    completion_criteria: [
      { id: '0'.repeat(26), ordinal: 1, text: 'a', done: false, kind: 'planned', struck_by: null }
    ],
    artifacts: [{ id: '0'.repeat(26), label: 'a', pointer: 'a' }],
    spine: {
      active_goal: 'a',
      next_step: 'a',
      last_session: 'a',
      open_risks: [{ id: '0'.repeat(26), scope: 'a', text: 'a', refs: ['a'] }],
      key_decisions: [{ id: '0'.repeat(26), decision_id: '0'.repeat(26), title: 'a', scope: 'a' }],
      out_of_scope: [{ id: '0'.repeat(26), text: 'a' }]
    },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  }

  const candidatePaths = deriveCandidates(ThreadRecord.schema, validThread, []).map((candidate) =>
    candidate.path.join('.')
  )

  for (const expected of [
    'spine.open_risks',
    'spine.open_risks.0.text',
    'spine.open_risks.0.refs',
    'spine.key_decisions',
    'spine.key_decisions.0.title',
    'spine.out_of_scope',
    'spine.out_of_scope.0.text',
    'completion_criteria.0.text',
    'completion_criteria.0.struck_by'
  ]) {
    assert.ok(candidatePaths.includes(expected), `expected a derived candidate at "${expected}"`)
  }
})
