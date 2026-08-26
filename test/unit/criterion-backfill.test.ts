import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backfillCriterionIds, criterionIdForScope } from '../../src/domain/criterion-backfill.ts'
import type { Thread, Criterion, Risk, KeyDecision } from '../../src/schema/thread.ts'

const CRITERION_1_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
const CRITERION_2_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA2'
const CRITERION_3_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA3'

const PINNED_CRITERIA: Criterion[] = [
  { id: CRITERION_1_ID, ordinal: 1, text: 'ship the field', done: true, kind: 'planned', struck_by: null },
  { id: CRITERION_2_ID, ordinal: 2, text: 'ship the renderer', done: false, kind: 'planned', struck_by: null },
  { id: CRITERION_3_ID, ordinal: 3, text: 'ship the backfill', done: false, kind: 'planned', struck_by: null }
]

const baseThread = (openRisks: Risk[], keyDecisions: KeyDecision[]): Thread => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  slug: 'a-thread',
  title: 'a thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: PINNED_CRITERIA,
  spine: {
    active_goal: 'ship it',
    next_step: 'write the tests',
    last_session: 'read the spec',
    open_risks: openRisks,
    key_decisions: keyDecisions,
    out_of_scope: []
  },
  created_at: '2026-08-26T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z'
})

test('criterion-backfill.a-legacy-risk-scoped-criterion-2-gains-the-matching-criterion-ulid', () => {
  const legacyRisk: Risk = { id: '01ARZ3NDEKTSV4RRFFQ69G5FB1', scope: 'criterion 2', text: 'a legacy risk', refs: [] }
  const thread = baseThread([legacyRisk], [])

  const migrated = backfillCriterionIds(thread)

  assert.equal(migrated.spine.open_risks[0]?.criterion_id, CRITERION_2_ID)
  assert.notEqual(migrated.spine.open_risks[0]?.criterion_id, CRITERION_1_ID)
  assert.notEqual(migrated.spine.open_risks[0]?.criterion_id, CRITERION_3_ID)
})

test('criterion-backfill.a-legacy-key-decision-scoped-criterion-2-gains-the-matching-criterion-ulid', () => {
  const legacyLink: KeyDecision = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
    decision_id: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
    title: 'a legacy decision',
    scope: 'criterion 2'
  }
  const thread = baseThread([], [legacyLink])

  const migrated = backfillCriterionIds(thread)

  assert.equal(migrated.spine.key_decisions[0]?.criterion_id, CRITERION_2_ID)
})

test('criterion-backfill.prose-naming-no-criterion-stays-unanchored', () => {
  const untaggedRisk: Risk = { id: '01ARZ3NDEKTSV4RRFFQ69G5FB4', scope: 'shipped regressions', text: 'no criterion here', refs: [] }
  const thread = baseThread([untaggedRisk], [])

  const migrated = backfillCriterionIds(thread)

  assert.equal(migrated.spine.open_risks[0]?.criterion_id, undefined)
})

test('criterion-backfill.a-scope-naming-an-ordinal-with-no-criterion-stays-unanchored', () => {
  const outOfRangeRisk: Risk = { id: '01ARZ3NDEKTSV4RRFFQ69G5FB5', scope: 'criterion 9', text: 'out of range', refs: [] }
  const thread = baseThread([outOfRangeRisk], [])

  const migrated = backfillCriterionIds(thread)

  assert.equal(migrated.spine.open_risks[0]?.criterion_id, undefined)
})

test('criterion-backfill.an-already-tagged-risk-is-left-untouched', () => {
  const taggedRisk: Risk = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FB6',
    scope: 'criterion 3',
    text: 'already tagged',
    refs: [],
    criterion_id: CRITERION_1_ID
  }
  const thread = baseThread([taggedRisk], [])

  const migrated = backfillCriterionIds(thread)

  assert.equal(migrated.spine.open_risks[0]?.criterion_id, CRITERION_1_ID)
})

test('criterion-backfill.criterionIdForScope-resolves-against-the-pinned-criteria-list', () => {
  assert.equal(criterionIdForScope('criterion 2', PINNED_CRITERIA), CRITERION_2_ID)
  assert.equal(criterionIdForScope('CRITERION 3', PINNED_CRITERIA), CRITERION_3_ID)
  assert.equal(criterionIdForScope('tooling', PINNED_CRITERIA), undefined)
  assert.equal(criterionIdForScope('MSP-9 dispatch', PINNED_CRITERIA), undefined)
})
