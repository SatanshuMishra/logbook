import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { BindingRecord, type Binding } from '../../src/schema/binding.ts'
import * as caps from '../../src/schema/caps.ts'

const THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ'
const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const RISK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const DECISION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY'
const ARTIFACT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0'
const A_REAL_SHA = '0123456789abcdef0123456789abcdef01234567'

const CONTENT_NOT_POINTER = [
  ['a-line-break', 'docs/spec.md\nsecond line'],
  ['a-code-fence', 'see ```ts for the shape'],
  ['a-diff-hunk-marker', '@@ -1,2 +1,2 @@']
] as const

const baseThread = (): Thread => ({
  id: THREAD_ID,
  slug: 'a-thread',
  title: 'a thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [{ id: CRITERION_ID, ordinal: 1, text: 'ship it', done: false, kind: 'planned', struck_by: null }],
  spine: {
    active_goal: 'ship it',
    next_step: 'write the tests',
    last_session: 'read the spec',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z'
})

const threadWithRiskRef = (ref: string): Thread => {
  const thread = baseThread()
  return {
    ...thread,
    spine: { ...thread.spine, open_risks: [{ id: RISK_ID, scope: 'ship it', text: 'a risk', refs: [ref] }] }
  }
}

const baseDecision = (): Decision => ({
  id: DECISION_ID,
  thread_id: THREAD_ID,
  title: 'a decision',
  context: 'the context',
  options: ['one', 'two'],
  outcome: 'the outcome',
  commit: A_REAL_SHA,
  supersedes: [],
  created_at: '2026-08-28T00:00:00.000Z'
})

const baseBinding = (branch: string): Binding => ({
  id: ARTIFACT_ID,
  thread_id: THREAD_ID,
  branch,
  created_at: '2026-08-28T00:00:00.000Z'
})

for (const [label, value] of CONTENT_NOT_POINTER) {
  test(`git-boundary.a-risk-ref-carrying-${label}-is-refused`, () => {
    const result = ThreadRecord.parse(threadWithRiskRef(value))
    assert.equal(result.ok, false, `a risk ref carrying ${label} must be refused`)
    if (result.ok) return
    assert.equal(result.field, 'spine.open_risks.0.refs.0')
    assert.equal(result.retryable, true)
    assert.match(result.message, /remedy: /)
  })
}

test('git-boundary.a-risk-ref-that-is-an-address-is-accepted', () => {
  const result = ThreadRecord.parse(threadWithRiskRef('docs/specs/2026-08-28-continuity-goal-model.md#L120'))
  assert.equal(result.ok, true, 'an ordinary path-and-anchor pointer must be accepted')
  if (!result.ok) return
  assert.equal(result.value.spine.open_risks[0]?.refs[0], 'docs/specs/2026-08-28-continuity-goal-model.md#L120')
})

test('git-boundary.an-artifact-pointer-carrying-a-code-fence-is-refused', () => {
  const result = ThreadRecord.parse({
    ...baseThread(),
    artifacts: [{ id: ARTIFACT_ID, label: 'the plan', pointer: 'see ```ts' }]
  })
  assert.equal(result.ok, false, 'an artifact pointer carrying a code fence must be refused')
  if (result.ok) return
  assert.equal(result.field, 'artifacts.0.pointer')
})

test('git-boundary.a-decision-commit-that-is-not-a-sha-is-refused', () => {
  const result = DecisionRecord.parse({ ...baseDecision(), commit: 'e5f0195' })
  assert.equal(result.ok, false, 'a short sha must be refused; the stored field is a full object id')
  if (result.ok) return
  assert.equal(result.field, 'commit')
  assert.equal(result.retryable, true)
  assert.match(result.example, /^[0-9a-f]{40}$/)
})

test('git-boundary.a-decision-commit-carrying-a-diff-hunk-marker-is-refused', () => {
  const result = DecisionRecord.parse({ ...baseDecision(), commit: '@@ -1,2 +1,2 @@' })
  assert.equal(result.ok, false, 'a commit field carrying diff content must be refused')
  if (result.ok) return
  assert.equal(result.field, 'commit')
})

test('git-boundary.a-decision-commit-that-is-a-sha-or-null-is-accepted', () => {
  assert.equal(DecisionRecord.parse(baseDecision()).ok, true, 'a forty-character object id must be accepted')
  assert.equal(
    DecisionRecord.parse({ ...baseDecision(), commit: null }).ok,
    true,
    'a null commit must stay acceptable; it is what an unreadable HEAD stores'
  )
  assert.equal(
    DecisionRecord.parse({ ...baseDecision(), commit: 'a'.repeat(64) }).ok,
    true,
    'a sixty-four-character object id must be accepted'
  )
  assert.equal(caps.DECISION_COMMIT_MAX, 64)
})

test('git-boundary.a-binding-branch-carrying-a-line-break-is-refused-by-its-record-schema', () => {
  const result = BindingRecord.parse(baseBinding('feat/x\nrm -rf /'))
  assert.equal(result.ok, false, 'a binding branch carrying a line break must be refused')
  if (result.ok) return
  assert.equal(result.field, 'branch')
})

test('git-boundary.an-empty-binding-branch-is-refused', () => {
  const result = BindingRecord.parse(baseBinding(''))
  assert.equal(result.ok, false, 'an empty binding branch must be refused')
  if (result.ok) return
  assert.equal(result.field, 'branch')
})

test('git-boundary.a-binding-branch-that-is-an-ordinary-branch-name-is-accepted', () => {
  assert.equal(BindingRecord.parse(baseBinding('feat/u1-schema-foundations')).ok, true)
})
