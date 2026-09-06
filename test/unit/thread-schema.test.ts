import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord } from '../../src/schema/thread.ts'
import type { Thread } from '../../src/schema/thread.ts'
import { SPINE_LANDED_MAX } from '../../src/schema/caps.ts'

const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FBA'
const ULID_B = '01ARZ3NDEKTSV4RRFFQ69G5FBB'

const baseThread = (): Thread => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  slug: 'a-thread',
  title: 'a thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [{ id: CRITERION_ID, ordinal: 1, text: 'ship it', done: false, kind: 'planned', struck_by: null }],
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

test('thread-schema.landed.a-spine-carrying-it-round-trips', () => {
  const thread = baseThread()
  thread.spine.landed = 'focus removal shipped; suite green'

  const parsed = ThreadRecord.parse(thread)

  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('expected the record to parse')
  assert.equal(parsed.value.spine.landed, 'focus removal shipped; suite green')
})

test('thread-schema.retired.an-artifact-and-a-risk-both-carry-it', () => {
  const thread = baseThread()
  thread.artifacts = [
    { id: ULID_A, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  ]
  thread.spine.open_risks = [
    { id: ULID_B, scope: 'merge', text: 'a risk', refs: [], retired: true }
  ]

  const parsed = ThreadRecord.parse(thread)

  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('expected the record to parse')
  assert.equal(parsed.value.artifacts?.[0]?.retired, false)
  assert.equal(parsed.value.spine.open_risks[0]?.retired, true)
})

test('thread-schema.landed.over-its-cap-is-refused', () => {
  const thread = baseThread()
  thread.spine.landed = 'x'.repeat(SPINE_LANDED_MAX + 1)

  const parsed = ThreadRecord.parse(thread)

  assert.equal(parsed.ok, false)
})
