import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../../src/schema/thread.ts'
import type { DecisionIntegrity } from '../../src/render/briefing.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import * as caps from '../../src/schema/caps.ts'

export type SweepShape = {
  fill: string
  anchored: boolean
  criteriaCount: number
  keyDecisionCount: number
  criterionTextLength: number
  bulkCount: number
}

export type SweepFixture = { thread: Thread; predecessor: Thread; integrity: DecisionIntegrity }

const CRITERION_CHECK_HELD_LENGTH = 40
const CRITERION_RESULT_HELD_LENGTH = 60
const RISK_REF_HELD_LENGTH = 40

export const SWEEP_FIXTURE_HELD_FIXED = [
  'open_risks and out_of_scope are held at the largest element count the record byte cap admits, each at its own text cap, and every risk carries exactly one reference at a fixed short length',
  'every criterion carries a populated check at a fixed short length, ordinals ascend from one, and no criterion is struck',
  'the last criterion is marked done with a populated result and result_status at a fixed short length, so the rendered result line is exercised, except in the one cell where anchoring is on and there is exactly one criterion, where that sole criterion is also the anchor and is kept open instead so the anchored criterion never settles; every criterion before the last always stays open',
  'title, slug, blocked_by, active_goal, next_step and last_session are held at their schema caps',
  'a predecessor thread is always resolved, and the written pointer is passed as null',
  'key decisions split evenly into dangling and quarantined decision ids, so no decision resolves'
]

export const SWEEP_FIXTURE_NOT_SWEPT = [
  'risk text length, out-of-scope text length and key-decision title length, each held at its schema cap',
  'criterion check length, criterion result length (recorded only on the last criterion) and risk reference length, each held at a fixed short length rather than the byte-budget-stressing caps used for risk text, out-of-scope text and key-decision title, so the fixed-count worst-case shapes elsewhere stay schema-admissible',
  'criterion status for every criterion but the last, which is held open, and for the last criterion itself whenever anchoring is on and it is also the sole (first) criterion; the anchored criterion (criteria[0]) is kept open in every swept cell where anchoring is on, so this change never moves a risk or key decision into the settled lane through the criterion-status mechanism',
  'mixed fills within one record, so a record is entirely ASCII or entirely multi-byte',
  'the escape-expanding fill class, meaning characters the stored-text escape rewrites into a U+XXXX token and so grows roughly sixfold; every swept fill passes through that escape unchanged, so no swept record carries one',
  'grapheme density, meaning how many UTF-16 code units one reader-visible character spans; every swept fill is exactly one code unit per grapheme, so every swept record has a grapheme count equal to its character count'
]

export const buildSweepFixture = (rt: Runtime, shape: SweepShape): SweepFixture => {
  const fillOf = (length: number): string => shape.fill.repeat(length)

  const criteria: Criterion[] = Array.from({ length: shape.criteriaCount }, (_, index) => {
    const isLast = index === shape.criteriaCount - 1
    const isAnchorCriterion = shape.anchored && index === 0
    const done = isLast && !isAnchorCriterion
    return {
      id: rt.ulid(),
      ordinal: index + 1,
      text: fillOf(shape.criterionTextLength),
      done,
      kind: 'planned',
      check: fillOf(CRITERION_CHECK_HELD_LENGTH),
      result: done ? fillOf(CRITERION_RESULT_HELD_LENGTH) : undefined,
      result_status: done ? 'verified' : undefined,
      struck_by: null
    }
  })

  const currentCriterion = criteria[0]
  const anchor = shape.anchored && currentCriterion !== undefined ? { criterion_id: currentCriterion.id } : {}

  const risks: Risk[] = Array.from({ length: shape.bulkCount }, () => ({
    id: rt.ulid(),
    scope: 'sweep',
    text: fillOf(caps.RISK_TEXT_MAX),
    refs: [fillOf(RISK_REF_HELD_LENGTH)],
    retired: false,
    ...anchor
  }))

  const keyDecisions: KeyDecision[] = Array.from({ length: shape.keyDecisionCount }, () => ({
    id: rt.ulid(),
    decision_id: rt.ulid(),
    title: fillOf(caps.KEY_DECISION_TITLE_MAX),
    scope: 'sweep',
    ...anchor
  }))

  const outOfScope: OutOfScope[] = Array.from({ length: shape.bulkCount }, () => ({
    id: rt.ulid(),
    text: fillOf(caps.OUT_OF_SCOPE_TEXT_MAX)
  }))

  const predecessor: Thread = {
    id: rt.ulid(),
    slug: 'p'.repeat(caps.THREAD_SLUG_MAX),
    title: fillOf(caps.THREAD_TITLE_MAX),
    status: 'done',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'closed',
      next_step: 'closed',
      landed: '',
      last_session: 'closed',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }

  const thread: Thread = {
    id: rt.ulid(),
    slug: 's'.repeat(caps.THREAD_SLUG_MAX),
    title: fillOf(caps.THREAD_TITLE_MAX),
    status: 'open',
    blocked_by: fillOf(caps.THREAD_BLOCKED_BY_MAX),
    predecessor_id: predecessor.id,
    completion_criteria: criteria,
    spine: {
      active_goal: fillOf(caps.SPINE_ACTIVE_GOAL_MAX),
      next_step: fillOf(caps.SPINE_NEXT_STEP_MAX),
      landed: '',
      last_session: fillOf(caps.SPINE_LAST_SESSION_MAX),
      open_risks: risks,
      key_decisions: keyDecisions,
      out_of_scope: outOfScope
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }

  const danglingCount = Math.ceil(shape.keyDecisionCount / 2)

  return {
    thread,
    predecessor,
    integrity: {
      resolved: 0,
      dangling: keyDecisions.slice(0, danglingCount).map((entry) => entry.decision_id),
      quarantined: keyDecisions.slice(danglingCount).map((entry) => entry.decision_id)
    }
  }
}
