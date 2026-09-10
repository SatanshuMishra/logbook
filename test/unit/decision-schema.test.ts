import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DecisionRecord } from '../../src/schema/decision.ts'
import type { Decision } from '../../src/schema/decision.ts'
import * as caps from '../../src/schema/caps.ts'

const DECISION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY'
const THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ'

const baseDecision = (): Decision => ({
  id: DECISION_ID,
  thread_id: THREAD_ID,
  title: 'a decision',
  context: 'the context',
  options: ['one', 'two'],
  outcome: 'the outcome',
  commit: null,
  supersedes: [],
  created_at: '2026-08-28T00:00:00.000Z'
})

test('decision-schema.a-decision-record-under-the-byte-cap-parses', () => {
  const parsed = DecisionRecord.parse(baseDecision())
  assert.equal(parsed.ok, true, 'a decision record well under the byte cap must still parse')
})

test('decision-schema.a-decision-record-over-the-byte-cap-is-refused-by-the-schema-directly', () => {
  const oversized: Decision = {
    ...baseDecision(),
    context: 'x'.repeat(40000),
    outcome: 'x'.repeat(40000)
  }
  const observed = Buffer.byteLength(JSON.stringify(oversized), 'utf8')
  assert.ok(
    observed > caps.DECISION_RECORD_SERIALISED_MAX_BYTES,
    `decision-schema fixture: the oversized decision must itself exceed the byte cap; observed ${observed}`
  )

  const parsed = DecisionRecord.parse(oversized)

  assert.equal(
    parsed.ok,
    false,
    'a decision record over the whole-record byte cap must be refused by DecisionRecord.parse itself, independent of any handler'
  )
})
