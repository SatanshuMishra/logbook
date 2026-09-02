import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Decision } from '../../src/schema/decision.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import type { Criterion, Thread } from '../../src/schema/thread.ts'
import type { DecisionIntegrity } from '../../src/render/briefing.ts'
import { renderDecisionResource, renderSessionsResource, renderThreadDetail } from '../../src/server/resource-render.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'

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

const NO_BINDINGS = { bound: [], unreadable: 0, unread: false }

const CRITERION_BASE: Criterion = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FC0',
  ordinal: 1,
  text: 'a criterion render fixture',
  done: true,
  kind: 'planned',
  struck_by: null
}

const threadWithCriterion = (criterion: Criterion): Thread => ({
  ...THREAD_WITHOUT_BINDINGS,
  completion_criteria: [criterion]
})

const criterionLinesOf = (rendered: string): string[] => {
  const lines = rendered.split('\n')
  const start = lines.indexOf('Completion criteria:')
  const end = lines.indexOf('Open risks:')
  return lines.slice(start + 1, end)
}

test('resource-render.thread.criterion-check-not-recorded-when-absent', () => {
  const rendered = renderThreadDetail(
    threadWithCriterion({ ...CRITERION_BASE, done: true }),
    NO_DECISIONS,
    null,
    null,
    NO_BINDINGS
  )
  assert.ok(criterionLinesOf(rendered).includes('  check: not recorded'))
})

test('resource-render.thread.criterion-result-not-recorded-when-check-present-but-result-absent', () => {
  const rendered = renderThreadDetail(
    threadWithCriterion({ ...CRITERION_BASE, done: true, check: 'the recorded check' }),
    NO_DECISIONS,
    null,
    null,
    NO_BINDINGS
  )
  assert.ok(criterionLinesOf(rendered).includes('  result: not recorded'))
})

test('resource-render.thread.criterion-result-status-not-recorded-when-absent', () => {
  const rendered = renderThreadDetail(
    threadWithCriterion({
      ...CRITERION_BASE,
      done: true,
      check: 'the recorded check',
      result: 'the recorded result text'
    }),
    NO_DECISIONS,
    null,
    null,
    NO_BINDINGS
  )
  assert.ok(criterionLinesOf(rendered).includes('  result: the recorded result text (not recorded)'))
})

test('resource-render.thread.open-criterion-omits-the-result-line', () => {
  const rendered = renderThreadDetail(
    threadWithCriterion({ ...CRITERION_BASE, done: false, result: null }),
    NO_DECISIONS,
    null,
    null,
    NO_BINDINGS
  )
  const lines = criterionLinesOf(rendered)
  assert.ok(lines.some((line) => line.startsWith('  check:')), 'expected the check line to still render')
  assert.ok(
    lines.every((line) => !line.startsWith('  result:')),
    `expected no result line for an open criterion, got ${JSON.stringify(lines)}`
  )
})

test('resource-render.sessions.grapheme-budget-not-exceeded-by-astral-first-line', () => {
  const astralFirstLine = '\u{1F600}'.repeat(150)
  assert.ok(astralFirstLine.length > 200, 'expected the fixture first line to exceed 200 UTF-16 code units')
  const entry: SessionEntry = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FD0',
    thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FD1',
    actor: 'claude',
    body: astralFirstLine,
    created_at: '2026-08-24T00:00:00.000Z'
  }
  const rendered = renderSessionsResource({ threadId: entry.thread_id, entries: [entry], quarantined: [], threadQuarantinedReason: null })
  assert.ok(!rendered.includes(CLIP_MARKER), 'expected no clip marker for a first line under the grapheme budget')
  assert.ok(
    !rendered.includes('shortened to fit this listing'),
    'expected no shortened-lines note for a first line under the grapheme budget'
  )
})

test('resource-render.sessions.marks-a-first-line-genuinely-over-budget', () => {
  const overBudgetFirstLine = 'a'.repeat(250)
  const entry: SessionEntry = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FD2',
    thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FD1',
    actor: 'claude',
    body: overBudgetFirstLine,
    created_at: '2026-08-24T00:00:00.000Z'
  }
  const rendered = renderSessionsResource({ threadId: entry.thread_id, entries: [entry], quarantined: [], threadQuarantinedReason: null })
  assert.ok(rendered.includes(CLIP_MARKER), 'expected the inline clip marker on a first line over the grapheme budget')
  const noteCount = rendered.split('\n').filter((line) => line.includes('shortened to fit this listing')).length
  assert.equal(noteCount, 1, `expected exactly one shortened-lines note line, got ${noteCount}`)
})

test('resource-render.thread.last-session-legacy-note-follows-the-unchanged-line', () => {
  const thread: Thread = {
    ...THREAD_WITHOUT_BINDINGS,
    spine: { ...THREAD_WITHOUT_BINDINGS.spine, last_session: 'a hand-written last-session summary' }
  }
  const rendered = renderThreadDetail(thread, NO_DECISIONS, null, null, NO_BINDINGS)
  const lines = rendered.split('\n')
  const lastSessionIndex = lines.indexOf('Last session: a hand-written last-session summary')
  assert.notEqual(lastSessionIndex, -1, `expected the Last session line to be byte-unchanged, got ${JSON.stringify(lines)}`)
  const noteLine = lines[lastSessionIndex + 1]
  assert.ok(
    noteLine !== undefined &&
      noteLine.includes('park_thread no longer writes this field') &&
      noteLine.includes(`logbook://sessions/${THREAD_WITHOUT_BINDINGS.id}`),
    `expected the legacy note to follow the Last session line, got ${JSON.stringify(noteLine)}`
  )
})

test('resource-render.thread.last-session-legacy-note-is-omitted-when-last-session-is-empty', () => {
  const thread: Thread = {
    ...THREAD_WITHOUT_BINDINGS,
    spine: { ...THREAD_WITHOUT_BINDINGS.spine, last_session: '' }
  }
  const rendered = renderThreadDetail(thread, NO_DECISIONS, null, null, NO_BINDINGS)
  const lines = rendered.split('\n')
  const lastSessionIndex = lines.indexOf('Last session: ')
  assert.notEqual(lastSessionIndex, -1, `expected the Last session line to still render, got ${JSON.stringify(lines)}`)
  const noteLine = lines[lastSessionIndex + 1]
  assert.ok(
    noteLine === undefined || !noteLine.includes('park_thread no longer writes this field'),
    `expected no legacy note when last_session is empty, got ${JSON.stringify(noteLine)}`
  )
})
