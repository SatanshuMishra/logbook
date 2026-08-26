import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord } from '../../src/schema/thread.ts'
import type { Thread } from '../../src/schema/thread.ts'

const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const RISK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const DECISION_LINK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX'
const DECISION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY'

const baseThread = (): Thread => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  slug: 'a-thread',
  title: 'a thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [{ id: CRITERION_ID, ordinal: 1, text: 'ship it', done: false, kind: 'planned', struck_by: null }],
  spine: {
    active_goal: 'ship it',
    next_step: 'write the tests',
    last_session: 'read the spec',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-08-26T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z'
})

test('thread-schema.criterion-id.a-risk-carrying-it-round-trips', () => {
  const thread = baseThread()
  const riskWithCriterionId = { id: RISK_ID, scope: 'ship it', text: 'a risk', refs: [], criterion_id: CRITERION_ID }
  const threadWithTaggedRisk: Thread = {
    ...thread,
    spine: { ...thread.spine, open_risks: [riskWithCriterionId] }
  }

  const result = ThreadRecord.parse(threadWithTaggedRisk)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the thread carrying a tagged risk to parse')
  }
  assert.equal(result.value.spine.open_risks[0]?.criterion_id, CRITERION_ID)
})

test('thread-schema.criterion-id.a-key-decision-carrying-it-round-trips', () => {
  const thread = baseThread()
  const keyDecisionWithCriterionId = {
    id: DECISION_LINK_ID,
    decision_id: DECISION_ID,
    title: 'a decision',
    scope: 'ship it',
    criterion_id: CRITERION_ID
  }
  const threadWithTaggedDecision: Thread = {
    ...thread,
    spine: { ...thread.spine, key_decisions: [keyDecisionWithCriterionId] }
  }

  const result = ThreadRecord.parse(threadWithTaggedDecision)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the thread carrying a tagged key decision to parse')
  }
  assert.equal(result.value.spine.key_decisions[0]?.criterion_id, CRITERION_ID)
})

test('thread-schema.criterion-id.a-risk-without-it-still-parses-unanchored', () => {
  const thread = baseThread()
  const untaggedRisk = { id: RISK_ID, scope: 'shipped regressions', text: 'a risk naming no criterion', refs: [] }
  const threadWithUntaggedRisk: Thread = {
    ...thread,
    spine: { ...thread.spine, open_risks: [untaggedRisk] }
  }

  const result = ThreadRecord.parse(threadWithUntaggedRisk)

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected the legacy thread with no criterion_id to parse without quarantine')
  }
  assert.equal(result.value.spine.open_risks[0]?.criterion_id, undefined)
})
