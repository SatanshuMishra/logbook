import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkChangeShape } from '../../src/store/records.ts'
import type { Thread } from '../../src/schema/thread.ts'

const CRITERION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

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

test('records.write-refuses-a-criterion-carrying-no-settledness', () => {
  const thread = threadFixture()
  const stripped = {
    ...thread,
    completion_criteria: thread.completion_criteria.map(({ settledness, ...rest }) => rest)
  }

  const result = checkChangeShape({ kind: 'thread', record: stripped as unknown as Thread })

  assert.equal(result.ok, false, 'the read-time substitution exists for legacy records only; a write may never produce one')
})
