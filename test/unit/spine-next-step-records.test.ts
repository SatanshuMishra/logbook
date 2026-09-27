import test from 'node:test'
import assert from 'node:assert/strict'
import { contributeToSpine, type SpineContribution } from '../../src/domain/spine.ts'
import type { Spine } from '../../src/schema/thread.ts'
import { testRuntime } from '../support/runtime.ts'

const SPINE_WITH_NO_LIST: Spine = {
  active_goal: 'ship the retry policy',
  next_step: 'read the retry module',
  landed: '',
  last_session: '',
  open_risks: [],
  key_decisions: [],
  out_of_scope: []
}

const merged = (stored: Spine, contribution: SpineContribution): Spine => {
  const result = contributeToSpine(stored, contribution)
  if (!result.ok) throw new Error(`spine fixture: the contribution was refused: ${result.message}`)
  return result.value
}

test('spine.next-step-records-are-replaced-with-the-next-step-and-kept-otherwise', () => {
  const recordId = testRuntime().ulid()

  const untouched = merged(SPINE_WITH_NO_LIST, { active_goal: 'ship the retry policy with jitter' })
  assert.equal(
    Object.hasOwn(untouched, 'next_step_records'),
    false,
    'a contribution that leaves next_step alone must not add a records list to a spine that never had one'
  )

  const stepped = merged(SPINE_WITH_NO_LIST, { next_step: 'In src/retry.ts, cap the jitter', next_step_records: [recordId] })
  assert.deepEqual(stepped.next_step_records, [recordId])

  const goalOnly = merged(stepped, { active_goal: 'ship the retry policy with capped jitter' })
  assert.deepEqual(goalOnly.next_step_records, [recordId])

  const restepped = merged(goalOnly, { next_step: 'run the retry suite' })
  assert.deepEqual(restepped.next_step_records, [])
})
