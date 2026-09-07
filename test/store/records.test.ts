import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkChangeShape } from '../../src/store/records.ts'
import { rewriteCriterion, strikeCriterion } from '../../src/domain/criteria.ts'
import { testRuntime } from '../support/runtime.ts'
import type { Thread } from '../../src/schema/thread.ts'

const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const DECISION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FBA'

const threadFixture = (): Thread => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  slug: 'a-thread',
  title: 'a thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [
    {
      id: CRITERION_ID,
      ordinal: 1,
      text: 'ship it',
      done: false,
      kind: 'planned',
      struck_by: null,
      settledness: 'proposed',
      settled_by: null
    }
  ],
  spine: {
    active_goal: 'ship it',
    next_step: 'write the tests',
    last_session: 'read the spec',
    landed: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-08-26T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z'
})

test('records.a-thread-written-before-settledness-can-still-be-written', () => {
  const thread = threadFixture()
  const legacy = {
    ...thread,
    completion_criteria: thread.completion_criteria.map(({ settledness, ...rest }) => rest)
  } as unknown as Thread

  const initialShape = checkChangeShape({ kind: 'thread', record: legacy })
  assert.equal(initialShape.ok, true, 'a stored thread whose criterion carries no settledness must still be committable')

  const rt = testRuntime()
  const resolveDecision = () => true

  const rewritten = rewriteCriterion(
    rt,
    legacy,
    { criterionId: CRITERION_ID, text: 'ship it, revised', decisionId: DECISION_ID },
    resolveDecision
  )
  assert.equal(rewritten.ok, true, 'rewriting a legacy criterion must succeed even though it carries no settledness')
  if (!rewritten.ok) return
  const rewrittenShape = checkChangeShape({ kind: 'thread', record: rewritten.value })
  assert.equal(rewrittenShape.ok, true, 'the rewritten thread must still be committable with its settledness still absent')

  const struck = strikeCriterion(
    rt,
    legacy,
    { criterionId: CRITERION_ID, decisionId: DECISION_ID },
    resolveDecision
  )
  assert.equal(struck.ok, true, 'striking a legacy criterion must succeed even though it carries no settledness')
  if (!struck.ok) return
  const struckShape = checkChangeShape({ kind: 'thread', record: struck.value })
  assert.equal(struckShape.ok, true, 'the struck thread must still be committable with its settledness still absent')
})
