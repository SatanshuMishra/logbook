import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThreadRecord, criterionSettledness } from '../../src/schema/thread.ts'
import type { Thread } from '../../src/schema/thread.ts'
import * as caps from '../../src/schema/caps.ts'

const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FBA'
const ULID_B = '01ARZ3NDEKTSV4RRFFQ69G5FBB'

const threadFixture = (): Thread => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  slug: 'a-thread',
  title: 'a thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [
    {
      id: CRITERION_ID,
      ordinal: 1,
      text: 'ship it',
      done: false,
      kind: 'planned',
      struck_by: null,
      settledness: 'proposed',
      settled_by: null
    }
  ],
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
  const thread = threadFixture()
  const threadWithLanded: Thread = {
    ...thread,
    spine: { ...thread.spine, landed: 'focus removal shipped; suite green' }
  }

  const parsed = ThreadRecord.parse(threadWithLanded)

  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('expected the record to parse')
  assert.equal(parsed.value.spine.landed, 'focus removal shipped; suite green')
})

test('thread-schema.retired.an-artifact-and-a-risk-both-carry-it', () => {
  const thread = threadFixture()
  const retainedArtifact = { id: ULID_A, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  const retiredRisk = { id: ULID_B, scope: 'merge', text: 'a risk', refs: [], retired: true }
  const threadCarryingBoth: Thread = {
    ...thread,
    artifacts: [retainedArtifact],
    spine: { ...thread.spine, open_risks: [retiredRisk] }
  }

  const parsed = ThreadRecord.parse(threadCarryingBoth)

  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('expected the record to parse')
  assert.equal(parsed.value.artifacts?.[0]?.retired, false)
  assert.equal(parsed.value.spine.open_risks[0]?.retired, true)
})

test('thread-schema.criterion-with-no-settledness-parses-unchanged-and-reads-as-proposed', () => {
  const stored = threadFixture()
  const raw = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
  const criteria = raw.completion_criteria as Record<string, unknown>[]
  const { settledness, ...withoutSettledness } = { ...criteria[0] }
  void settledness
  criteria[0] = withoutSettledness
  const beforeBytes = Buffer.byteLength(JSON.stringify(raw), 'utf8')

  const parsed = ThreadRecord.parse(raw)

  assert.equal(parsed.ok, true, 'a record written before this field existed must still parse')
  if (!parsed.ok) return
  assert.equal(
    Buffer.byteLength(JSON.stringify(parsed.value), 'utf8'),
    beforeBytes,
    'parsing a legacy criterion must add no bytes; a default would materialize the missing field'
  )
  const parsedCriterion = parsed.value.completion_criteria[0]
  if (parsedCriterion === undefined) throw new Error('expected the parsed record to carry one criterion')
  assert.equal(
    parsedCriterion.settledness,
    undefined,
    'the parsed value itself carries no settledness for a legacy criterion; the substitution happens only when read'
  )
  assert.equal(
    criterionSettledness(parsedCriterion),
    'proposed',
    'the named reader substitutes proposed at read time for a legacy criterion, because nobody declared who stood behind it'
  )
})

test('thread-schema.criterion-settledness-refuses-an-unknown-value', () => {
  const stored = threadFixture()
  const raw = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
  const criteria = raw.completion_criteria as Record<string, unknown>[]
  criteria[0] = { ...criteria[0], settledness: 'probably' }

  const parsed = ThreadRecord.parse(raw)

  assert.equal(parsed.ok, false, 'settledness is a closed set of three values and a fourth is refused')
})

test('thread-schema.criterion-text-refuses-past-its-cap', () => {
  const stored = threadFixture()
  const raw = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
  const criteria = raw.completion_criteria as Record<string, unknown>[]
  criteria[0] = { ...criteria[0], text: 'x'.repeat(caps.CRITERION_TEXT_MAX + 1) }

  const parsed = ThreadRecord.parse(raw)

  assert.equal(parsed.ok, false, 'a capped field refuses rather than truncating')
  if (!parsed.ok) {
    assert.ok(
      parsed.message.includes(String(caps.CRITERION_TEXT_MAX)),
      `the refusal must name the numeric limit, got: ${parsed.message}`
    )
  }
})
