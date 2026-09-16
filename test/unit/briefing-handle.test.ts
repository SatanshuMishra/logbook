import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderBriefing,
  renderHandle,
  BRIEFING_HEAD_ONLY_LINE,
  type DecisionIntegrity
} from '../../src/render/briefing.ts'
import type { Thread, Criterion } from '../../src/schema/thread.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const CLEAN_INTEGRITY: DecisionIntegrity = { resolved: 2, dangling: [], quarantined: [] }

const criterion = (overrides: Partial<Criterion> = {}): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'the handle carries the head of the briefing',
  done: false,
  kind: 'planned',
  check: 'the unit test asserts it',
  struck_by: null,
  settledness: 'proposed',
  ...overrides
})

const handleFixture = (overrides: Partial<Thread> = {}): Thread => ({
  id: rt.ulid(),
  slug: 'briefing-handle-fixture',
  title: 'Handle Fixture Thread',
  status: 'open',
  blocked_by: null,
  artifacts: [{ id: rt.ulid(), label: 'the plan', pointer: 'docs/plans/handle.md', retired: false }],
  completion_criteria: [
    criterion({ ordinal: 1, done: true, result: 'landed', result_status: 'verified' }),
    criterion({ ordinal: 2 }),
    criterion({ ordinal: 3 }),
    criterion({ ordinal: 4, struck_by: rt.ulid() })
  ],
  spine: {
    active_goal: 'prove the handle omits what it says it omits',
    next_step: 'run the unit test',
    landed: 'the briefed record',
    last_session: 'wrote the record module',
    open_risks: [{ id: rt.ulid(), scope: 'thread', text: 'the census may reject a number', refs: [], retired: false }],
    key_decisions: [{ id: rt.ulid(), decision_id: rt.ulid(), title: 'the server decides the form', scope: 'thread' }],
    out_of_scope: [{ id: rt.ulid(), text: 'capping next_step' }]
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
})

const pointerFor = (thread: Thread): Pointer => ({
  thread_id: thread.id,
  written_at: rt.now(),
  session_id: 'briefing-handle-session'
})

const BELOW_THE_HEAD = [
  '**Artifacts:**',
  '**Active goal:**',
  '**Last session:**',
  '**Landed:**',
  '**Open risks:**',
  '**Key decisions:**',
  '**Out of scope:**',
  '**Completion criteria:**',
  '**Decisions:**'
]

test('handle.carries-the-head-of-the-briefing-and-says-why-it-is-short', () => {
  const thread = handleFixture()
  const handle = renderHandle(thread, CLEAN_INTEGRITY, pointerFor(thread), 0)

  assert.ok(handle.startsWith('# Your Preflight Briefing'))
  assert.ok(handle.includes('**Thread:** Handle Fixture Thread'))
  assert.ok(handle.includes('**Status:** open'))
  assert.ok(handle.includes('**Blockage:** none'))
  assert.ok(handle.includes('**Currently being worked:** yes'))
  assert.ok(handle.includes('**Criteria:** 1 of 3 done'))
  assert.ok(handle.includes('**Next step:**'))
  assert.ok(handle.includes('run the unit test'))
  assert.ok(handle.includes(BRIEFING_HEAD_ONLY_LINE))
  assert.ok(handle.includes(`See logbook://thread/${thread.id} for the complete record.`))
})

test('handle.omits-every-section-the-full-briefing-carries-below-the-head', () => {
  const thread = handleFixture()
  const pointer = pointerFor(thread)
  const full = renderBriefing(thread, CLEAN_INTEGRITY, pointer, null)
  const handle = renderHandle(thread, CLEAN_INTEGRITY, pointer, 0)

  for (const heading of BELOW_THE_HEAD) {
    assert.ok(full.includes(heading), `the fixture must produce ${heading} or its omission proves nothing`)
    assert.equal(handle.includes(heading), false, `expected the handle to omit ${heading}`)
  }
})

test('handle.is-a-fraction-of-the-full-briefing-on-the-same-thread', () => {
  const thread = handleFixture()
  const pointer = pointerFor(thread)
  const full = renderBriefing(thread, CLEAN_INTEGRITY, pointer, null)
  const handle = renderHandle(thread, CLEAN_INTEGRITY, pointer, 0)

  assert.ok(
    handle.length * 2 < full.length,
    `expected the handle to be less than half the full briefing: ${handle.length} against ${full.length}`
  )
})

test('handle.reports-the-records-it-could-not-read', () => {
  const thread = handleFixture()
  const handle = renderHandle(
    thread,
    { resolved: 1, dangling: [rt.ulid()], quarantined: [] },
    pointerFor(thread),
    2
  )

  assert.ok(handle.includes('1 linked decision record could not be read'))
  assert.ok(handle.includes('2 session log entries on this thread could not be read'))
})

test('handle.names-a-blockage-and-a-thread-no-session-is-working', () => {
  const thread = handleFixture({ blocked_by: 'waiting on review' })
  const handle = renderHandle(thread, CLEAN_INTEGRITY, null, 0)

  assert.ok(handle.includes('**Blocked:** waiting on review'))
  assert.ok(handle.includes('**Currently being worked:** no'))
})

test('handle.escapes-a-stored-value-bearing-markdown', () => {
  const thread = handleFixture({ title: '# not a heading' })
  const handle = renderHandle(thread, CLEAN_INTEGRITY, pointerFor(thread), 0)

  assert.equal(handle.includes('\n# not a heading'), false)
  assert.ok(handle.includes('not a heading'))
})
