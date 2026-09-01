import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, type DecisionIntegrity } from '../../src/render/briefing.ts'
import type { Thread, Criterion, Risk, KeyDecision } from '../../src/schema/thread.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const FOCUS_NOT_SET_LINE =
  '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'

const criterion = (overrides: Partial<Criterion> = {}): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'a criterion',
  done: false,
  kind: 'planned',
  struck_by: null,
  ...overrides
})

const risk = (overrides: Partial<Risk> = {}): Risk => ({
  id: rt.ulid(),
  scope: 'x',
  text: 'a risk',
  refs: [],
  ...overrides
})

const keyDecision = (overrides: Partial<KeyDecision> = {}): KeyDecision => ({
  id: rt.ulid(),
  decision_id: rt.ulid(),
  title: 'a decision',
  scope: 'x',
  ...overrides
})

const baseThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: rt.ulid(),
  slug: 'briefing-focus-fixture',
  title: 'Focus Fixture Thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the thing',
    next_step: 'write the tests',
    last_session: 'wrote the renderer',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
})

const pointerFor = (thread: Thread, focus: string[]): Pointer => ({
  thread_id: thread.id,
  written_at: rt.now(),
  session_id: 'session-focus-fixture',
  focus
})

test('briefing.focus.focused-risks-and-key-decisions-render-first', () => {
  const c1 = criterion({ ordinal: 1, text: 'the focused criterion' })
  const c2 = criterion({ ordinal: 2, text: 'a live criterion' })

  const riskOnC2 = risk({ text: 'a risk tied to the live criterion', criterion_id: c2.id })
  const riskOnC1 = risk({ text: 'a risk tied to the focused criterion', criterion_id: c1.id })

  const kdOnC2 = keyDecision({ title: 'a decision tied to the live criterion', scope: 's', criterion_id: c2.id })
  const kdOnC1 = keyDecision({ title: 'a decision tied to the focused criterion', scope: 's', criterion_id: c1.id })

  const thread = baseThread({
    completion_criteria: [c1, c2],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [riskOnC2, riskOnC1],
      key_decisions: [kdOnC2, kdOnC1],
      out_of_scope: []
    }
  })

  const pointer = pointerFor(thread, [c1.id])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)
  const lines = rendered.split('\n')

  const openRisksIndex = lines.indexOf('**Open risks:**')
  assert.deepEqual(
    [lines[openRisksIndex + 1], lines[openRisksIndex + 2]],
    [`- ${riskOnC1.id} a risk tied to the focused criterion`, `- ${riskOnC2.id} a risk tied to the live criterion`],
    'the risk tied to the focused criterion must render before the risk tied to the merely-live criterion'
  )

  const keyDecisionsIndex = lines.indexOf('**Key decisions:**')
  assert.deepEqual(
    [lines[keyDecisionsIndex + 1], lines[keyDecisionsIndex + 2]],
    [
      `- a decision tied to the focused criterion (decision ${kdOnC1.decision_id})`,
      `- a decision tied to the live criterion (decision ${kdOnC2.decision_id})`
    ],
    'the key decision tied to the focused criterion must render before the one tied to the merely-live criterion'
  )
})

test('briefing.focus.the-focus-line-names-display-labels-in-the-order-given', () => {
  const c1 = criterion({ ordinal: 1, text: 'first criterion' })
  const c2 = criterion({ ordinal: 2, text: 'second criterion' })
  const thread = baseThread({ completion_criteria: [c1, c2] })

  const pointer = pointerFor(thread, [c2.id, c1.id])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)

  assert.ok(
    rendered
      .split('\n')
      .includes(
        '**Focus:** c2, c1. Risks and key decisions on those goals render first, then the rest in the order they were recorded, apart from those on a goal already met or struck.'
      ),
    'the focus line must name each focused criterion by its display label, in the order supplied'
  )
})

test('briefing.focus.an-unresolvable-focus-id-renders-as-its-escaped-id', () => {
  const c1 = criterion({ ordinal: 1, text: 'the only criterion' })
  const thread = baseThread({ completion_criteria: [c1] })
  const unresolvableId = rt.ulid()

  const pointer = pointerFor(thread, [unresolvableId])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)

  assert.ok(
    rendered
      .split('\n')
      .includes(
        `**Focus:** ${unresolvableId}. Risks and key decisions on those goals render first, then the rest in the order they were recorded, apart from those on a goal already met or struck.`
      ),
    'a focus id that resolves to nothing on this thread must render as its own escaped id, not be dropped or crash the render'
  )
})

test('briefing.focus.the-focus-not-set-line-is-unchanged-when-focus-is-empty', () => {
  const c1 = criterion({ ordinal: 1, text: 'a criterion' })
  const thread = baseThread({ completion_criteria: [c1] })

  const pointerWithNoFocus = pointerFor(thread, [])
  const renderedWithPointer = renderBriefing(thread, EMPTY_INTEGRITY, pointerWithNoFocus, null)
  assert.ok(renderedWithPointer.split('\n').includes(FOCUS_NOT_SET_LINE))

  const renderedWithoutPointer = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(renderedWithoutPointer.split('\n').includes(FOCUS_NOT_SET_LINE))
})

test('briefing.focus.is-derived-only-from-a-pointer-naming-this-thread', () => {
  const c1 = criterion({ ordinal: 1, text: 'a criterion' })
  const thread = baseThread({ completion_criteria: [c1] })
  const otherThread = baseThread({ id: rt.ulid() })

  const pointerForOtherThread = pointerFor(otherThread, [c1.id])
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointerForOtherThread, null)

  assert.ok(
    rendered.split('\n').includes(FOCUS_NOT_SET_LINE),
    'a pointer naming a different thread must never leak focus onto this thread\'s briefing'
  )
})
