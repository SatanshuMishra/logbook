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

export const SWEEP_FIXTURE_HELD_FIXED = [
  'open_risks and out_of_scope are held at the largest element count the record byte cap admits, each at its own text cap',
  'every criterion is open, ordinals ascend from one, and no criterion is struck or done',
  'title, slug, blocked_by, active_goal, next_step and last_session are held at their schema caps',
  'a predecessor thread is always resolved, and the written pointer is passed as null',
  'key decisions split evenly into dangling and quarantined decision ids, so no decision resolves'
]

export const SWEEP_FIXTURE_NOT_SWEPT = [
  'risk text length, out-of-scope text length and key-decision title length, each held at its schema cap',
  'criterion status, which is held open so that no criterion collapses into the retired lane',
  'mixed fills within one record, so a record is entirely ASCII or entirely multi-byte',
  'the escape-expanding fill class, meaning characters the stored-text escape rewrites into a U+XXXX token and so grows roughly sixfold; both swept fills pass through that escape unchanged, so no swept record carries one',
  'grapheme density, meaning how many UTF-16 code units one reader-visible character spans; both swept fills are exactly one code unit per grapheme, so every swept record has a grapheme count equal to its character count'
]

export const buildSweepFixture = (rt: Runtime, shape: SweepShape): SweepFixture => {
  const fillOf = (length: number): string => shape.fill.repeat(length)

  const criteria: Criterion[] = Array.from({ length: shape.criteriaCount }, (_, index) => ({
    id: rt.ulid(),
    ordinal: index + 1,
    text: fillOf(shape.criterionTextLength),
    done: false,
    kind: 'planned',
    struck_by: null
  }))

  const currentCriterion = criteria[0]
  const anchor = shape.anchored && currentCriterion !== undefined ? { criterion_id: currentCriterion.id } : {}

  const risks: Risk[] = Array.from({ length: shape.bulkCount }, () => ({
    id: rt.ulid(),
    scope: 'sweep',
    text: fillOf(caps.RISK_TEXT_MAX),
    refs: [],
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
