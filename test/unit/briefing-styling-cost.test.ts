import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderStepBriefing } from '../../src/render/briefing.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import { testRuntime } from '../support/runtime.ts'
import { withCriterionFixture } from '../support/criterion-fixture.ts'

const rt = testRuntime()

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

const stepBriefingIn = (fixtureRt: Runtime, thread: Thread): string => {
  const opened = openStore(fixtureRt, fixtureRt.cwd)
  if (!opened.ok) throw new Error(`briefing-styling-cost fixture: the store did not open: ${opened.message}`)
  const committed = opened.value.commit([{ kind: 'thread', record: thread }], 'test: seed the styling cost fixture thread')
  if (!committed.ok) throw new Error(`briefing-styling-cost fixture: the thread did not commit: ${committed.detail}`)
  return renderStepBriefing(opened.value, thread, null)
}

const boldMarkerCount = (rendered: string): number => {
  const matches = rendered.match(/\*\*/g)
  return matches === null ? 0 : matches.length
}

const SMALL_CRITERIA_COUNT = 5
const LARGE_CRITERIA_COUNT = 40

test('briefing.styling-cost-is-a-function-of-sections-not-of-record-count', async () => {
  const smallThread = threadWithCriteriaCount(SMALL_CRITERIA_COUNT)
  const largeThread = threadWithCriteriaCount(LARGE_CRITERIA_COUNT)

  assert.equal(ThreadRecord.parse(smallThread).ok, true, 'the 5-criterion fixture must itself be schema-admissible')
  assert.equal(ThreadRecord.parse(largeThread).ok, true, 'the 40-criterion fixture must itself be schema-admissible')

  await withCriterionFixture(async (fixtureRt) => {
    const smallRendered = stepBriefingIn(fixtureRt, smallThread)
    const largeRendered = stepBriefingIn(fixtureRt, largeThread)

    const smallBoldCount = boldMarkerCount(smallRendered)
    const largeBoldCount = boldMarkerCount(largeRendered)

    assert.ok(
      smallBoldCount > 0,
      `expected the rendered briefing to carry at least one "**" bold marker, got ${smallBoldCount}`
    )
    assert.ok(
      largeRendered.split('\n').filter((line) => line.startsWith('- criterion ')).length === LARGE_CRITERIA_COUNT,
      `expected every one of the ${LARGE_CRITERIA_COUNT} criteria to be listed, or the comparison below measures nothing`
    )
    assert.equal(
      largeBoldCount,
      smallBoldCount,
      `expected the bold-marker count to stay identical from ${SMALL_CRITERIA_COUNT} to ${LARGE_CRITERIA_COUNT} completion criteria, got ${smallBoldCount} at ${SMALL_CRITERIA_COUNT} and ${largeBoldCount} at ${LARGE_CRITERIA_COUNT}`
    )
  })
})
