import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Decision } from '../../src/schema/decision.ts'
import type { Thread } from '../../src/schema/thread.ts'
import type { DecisionIntegrity } from '../../src/render/briefing.ts'
import { renderDecisionResource, renderThreadDetail } from '../../src/server/resource-render.ts'

const DECISION_WITHOUT_COMMIT: Omit<Decision, 'commit'> = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  title: 'widen the renderer census',
  context: 'array elements were never entered into the population',
  options: ['widen the collector', 'leave the census as it is'],
  outcome: 'widen the collector',
  supersedes: [],
  created_at: '2026-08-24T00:00:00.000Z'
}

const commitLineOf = (rendered: string): string | undefined =>
  rendered.split('\n').find((line) => line.startsWith('Commit:'))

test('resource-render.decision.renders-the-recorded-commit', () => {
  const rendered = renderDecisionResource({ ...DECISION_WITHOUT_COMMIT, commit: 'a1b2c3d' })
  assert.equal(commitLineOf(rendered), 'Commit: a1b2c3d')
})

test('resource-render.decision.renders-unknown-when-no-commit-was-recorded', () => {
  const rendered = renderDecisionResource({ ...DECISION_WITHOUT_COMMIT, commit: null })
  assert.equal(commitLineOf(rendered), 'Commit: unknown')
})

test('resource-render.decision.renders-unknown-when-the-commit-field-is-absent', () => {
  const rendered = renderDecisionResource(DECISION_WITHOUT_COMMIT as Decision)
  assert.equal(commitLineOf(rendered), 'Commit: unknown')
})

const THREAD_WITHOUT_BINDINGS: Thread = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  slug: 'binding-render-fixture',
  title: 'binding render fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'render the bindings block',
    next_step: 'assert the unread marker',
    last_session: 'none',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-08-24T00:00:00.000Z',
  updated_at: '2026-08-24T00:00:00.000Z'
}

const NO_DECISIONS: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const bindingLinesOf = (rendered: string): string[] => {
  const lines = rendered.split('\n')
  const start = lines.indexOf('Bindings:')
  const end = lines.indexOf('Decisions:')
  return lines.slice(start + 1, end)
}

test('resource-render.thread.says-nothing-about-bindings-it-could-not-read', () => {
  const rendered = renderThreadDetail(THREAD_WITHOUT_BINDINGS, NO_DECISIONS, null, null, {
    bound: [],
    unreadable: 0,
    unread: true
  })
  assert.deepEqual(bindingLinesOf(rendered), ['bindings could not be read; none is claimed either way'])
})

test('resource-render.thread.claims-no-bindings-only-when-it-read-them', () => {
  const rendered = renderThreadDetail(THREAD_WITHOUT_BINDINGS, NO_DECISIONS, null, null, {
    bound: [],
    unreadable: 0,
    unread: false
  })
  assert.deepEqual(bindingLinesOf(rendered), [])
})

test('resource-render.thread.counts-binding-records-it-could-not-parse', () => {
  const rendered = renderThreadDetail(THREAD_WITHOUT_BINDINGS, NO_DECISIONS, null, null, {
    bound: [],
    unreadable: 2,
    unread: false
  })
  assert.deepEqual(bindingLinesOf(rendered), ['unreadable binding records: 2'])
})
