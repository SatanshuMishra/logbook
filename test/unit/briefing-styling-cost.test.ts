import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const SHARED_TITLE = 'Styling Cost Fixture'
const SHARED_SLUG = 'styling-cost-fixture'

const SHARED_SPINE = {
  active_goal: 'prove styling cost is O(1) in the number of records',
  next_step: 'render both fixtures and compare bold-marker counts',
  landed: '',
  last_session: 'built the byte-identical fixture pair',
  open_risks: [{ id: rt.ulid(), scope: 'styling', text: 'a risk shared by both fixtures', refs: [], retired: false }],
  key_decisions: [{ id: rt.ulid(), decision_id: rt.ulid(), title: 'a key decision shared by both fixtures', scope: 'styling' }],
  out_of_scope: [{ id: rt.ulid(), text: 'an out-of-scope statement shared by both fixtures' }]
}

const criteriaOfCount = (count: number): Criterion[] =>
  Array.from({ length: count }, (_, index) => ({
    id: rt.ulid(),
    ordinal: index + 1,
    text: `criterion ${index + 1}`,
    done: false,
    kind: 'planned',
    struck_by: null
  }))

const threadWithCriteriaCount = (count: number): Thread => ({
  id: rt.ulid(),
  slug: SHARED_SLUG,
  title: SHARED_TITLE,
  status: 'open',
  blocked_by: null,
  completion_criteria: criteriaOfCount(count),
  spine: SHARED_SPINE,
  created_at: rt.now(),
  updated_at: rt.now()
})

const boldMarkerCount = (rendered: string): number => {
  const matches = rendered.match(/\*\*/g)
  return matches === null ? 0 : matches.length
}

const SMALL_CRITERIA_COUNT = 5
const LARGE_CRITERIA_COUNT = 40

test('briefing.styling-cost-is-a-function-of-sections-not-of-record-count', () => {
  const smallThread = threadWithCriteriaCount(SMALL_CRITERIA_COUNT)
  const largeThread = threadWithCriteriaCount(LARGE_CRITERIA_COUNT)

  assert.equal(ThreadRecord.parse(smallThread).ok, true, 'the 5-criterion fixture must itself be schema-admissible')
  assert.equal(ThreadRecord.parse(largeThread).ok, true, 'the 40-criterion fixture must itself be schema-admissible')

  const smallRendered = renderBriefing(smallThread, EMPTY_INTEGRITY, null, null)
  const largeRendered = renderBriefing(largeThread, EMPTY_INTEGRITY, null, null)

  const smallBoldCount = boldMarkerCount(smallRendered)
  const largeBoldCount = boldMarkerCount(largeRendered)

  assert.ok(
    smallBoldCount > 0,
    `expected the rendered briefing to carry at least one "**" bold marker, got ${smallBoldCount}`
  )
  assert.equal(
    largeBoldCount,
    smallBoldCount,
    `expected the bold-marker count to stay identical from ${SMALL_CRITERIA_COUNT} to ${LARGE_CRITERIA_COUNT} completion criteria, got ${smallBoldCount} at ${SMALL_CRITERIA_COUNT} and ${largeBoldCount} at ${LARGE_CRITERIA_COUNT}`
  )
})
