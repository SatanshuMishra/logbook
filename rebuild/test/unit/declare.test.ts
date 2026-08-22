import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { declare } from '../../src/schema/declare.ts'

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
