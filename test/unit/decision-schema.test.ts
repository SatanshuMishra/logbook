import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DecisionRecord } from '../../src/schema/decision.ts'
import type { Decision } from '../../src/schema/decision.ts'

const FORMER_DECISION_RECORD_SERIALISED_MAX_BYTES = 65536

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

test('decision-schema.a-small-decision-record-parses', () => {
  const parsed = DecisionRecord.parse(baseDecision())
  assert.equal(parsed.ok, true, 'a small decision record must parse')
})

test('decision-schema.a-decision-record-past-the-former-byte-cap-parses', () => {
  const large: Decision = {
    ...baseDecision(),
    context: 'x'.repeat(40000),
    outcome: 'x'.repeat(40000)
  }
  const observed = Buffer.byteLength(JSON.stringify(large), 'utf8')
  assert.ok(
    observed > FORMER_DECISION_RECORD_SERIALISED_MAX_BYTES,
    `decision-schema fixture: the large decision must exceed the former byte cap; observed ${observed}`
  )

  const parsed = DecisionRecord.parse(large)

  assert.equal(parsed.ok, true, 'a decision record past the former byte cap must parse')
})
