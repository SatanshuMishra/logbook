import test from 'node:test'
import assert from 'node:assert/strict'
import { contributeToSpine } from '../../src/domain/spine.ts'
import type { SpineContribution } from '../../src/domain/spine.ts'
import type { KeyDecision, Risk, Spine } from '../../src/schema/thread.ts'
import * as caps from '../../src/schema/caps.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { testRuntime } from '../support/runtime.ts'

const baseSpine = (): Spine => ({
  active_goal: 'ship cap enforcement',
  next_step: 'write the tests',
  last_session: 'read the spec',
  open_risks: [],
  key_decisions: [],
  out_of_scope: []
})

const buildOversizedAfterEscaping = (limit: number): { raw: string; escapedLength: number } => {
  const zeroWidthCount = 5
  const regularCount = limit - 20
  const raw = 'a'.repeat(regularCount) + '​'.repeat(zeroWidthCount)
  return { raw, escapedLength: escapeStored(raw).length }
}

const parseObservedFromMessage = (message: string): number => {
  const match = message.match(/observed (\d+) /)
  if (match === null || match[1] === undefined) {
    throw new Error(`could not parse an observed size out of refusal message: ${message}`)
  }
  return Number(match[1])
}

test('caps.refuse-whole-call', () => {
  const rt = testRuntime()
  const stored: Spine = { ...baseSpine(), open_risks: [{ id: rt.ulid(), scope: 'test', text: 'a pinned risk', refs: [] }] }
  const beforeSnapshot = JSON.parse(JSON.stringify(stored)) as Spine

  const validActiveGoal = 'a perfectly valid active goal well within its cap'
  const oversizedNextStep = 'n'.repeat(caps.SPINE_NEXT_STEP_MAX + 1)

  const soloActiveGoalResult = contributeToSpine(stored, { active_goal: validActiveGoal })
  assert.equal(soloActiveGoalResult.ok, true)
  if (!soloActiveGoalResult.ok) {
    throw new Error('expected the active_goal-only contribution to succeed on its own')
  }
  assert.equal(soloActiveGoalResult.value.active_goal, escapeStored(validActiveGoal))

  const combinedContribution: SpineContribution = {
    active_goal: validActiveGoal,
    next_step: oversizedNextStep
  }
  const combinedResult = contributeToSpine(stored, combinedContribution)

  assert.equal(combinedResult.ok, false)
  assert.equal('value' in combinedResult, false)
  assert.deepEqual(stored, beforeSnapshot)
})

test('caps.assert-contribution', () => {
  const rt = testRuntime()
  const makeRisk = (label: string): Risk => ({ id: rt.ulid(), scope: 'test', text: `risk ${label}`, refs: [] })

  const risks39 = Array.from({ length: caps.OPEN_RISKS_MAX_ELEMENTS - 1 }, (_, i) => makeRisk(String(i)))
  const stored39: Spine = { ...baseSpine(), open_risks: risks39 }

  const acceptResult = contributeToSpine(stored39, { open_risks: [makeRisk('new')] })
  assert.equal(acceptResult.ok, true)
  if (!acceptResult.ok) {
    throw new Error('expected the 40th risk to be accepted')
  }
  assert.equal(acceptResult.value.open_risks.length, caps.OPEN_RISKS_MAX_ELEMENTS)

  const risks40 = Array.from({ length: caps.OPEN_RISKS_MAX_ELEMENTS }, (_, i) => makeRisk(String(i)))
  const stored40: Spine = { ...baseSpine(), open_risks: risks40 }

  const refuseResult = contributeToSpine(stored40, { open_risks: [makeRisk('overflow')] })
  assert.equal(refuseResult.ok, false)
  if (refuseResult.ok) {
    throw new Error('expected the 41st risk to be refused')
  }
  assert.equal(refuseResult.field, 'spine.open_risks')
})

test('caps.assert-contribution-ignores-untouched-collections', () => {
  const rt = testRuntime()
  const makeRisk = (label: string): Risk => ({ id: rt.ulid(), scope: 'test', text: `risk ${label}`, refs: [] })
  const overCapRisks = Array.from({ length: caps.OPEN_RISKS_MAX_ELEMENTS + 5 }, (_, i) => makeRisk(String(i)))
  const stored: Spine = { ...baseSpine(), open_risks: overCapRisks }

  const result = contributeToSpine(stored, { next_step: 'a fresh next step' })

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('expected a contribution touching only next_step to succeed regardless of stored open_risks size')
  }
  assert.equal(result.value.open_risks.length, overCapRisks.length)
  assert.equal(result.value.next_step, escapeStored('a fresh next step'))
})

test('caps.count-is-capped', () => {
  const rt = testRuntime()
  const makeDecision = (label: string): KeyDecision => ({
    id: rt.ulid(),
    decision_id: rt.ulid(),
    title: `decision ${label}`,
    scope: 'test'
  })
  const stored = baseSpine()

  const decisions200 = Array.from({ length: caps.KEY_DECISIONS_MAX_ELEMENTS }, (_, i) => makeDecision(String(i)))
  const acceptResult = contributeToSpine(stored, { key_decisions: decisions200 })
  assert.equal(acceptResult.ok, true)
  if (!acceptResult.ok) {
    throw new Error('expected exactly 200 key_decisions to be accepted')
  }
  assert.equal(acceptResult.value.key_decisions.length, caps.KEY_DECISIONS_MAX_ELEMENTS)

  const decisions201 = [...decisions200, makeDecision('overflow')]
  const refuseResult = contributeToSpine(stored, { key_decisions: decisions201 })
  assert.equal(refuseResult.ok, false)
  if (refuseResult.ok) {
    throw new Error('expected 201 key_decisions to be refused')
  }
  assert.equal(refuseResult.field, 'spine.key_decisions')
})

test('caps.after-escaping', () => {
  const stored = baseSpine()
  const { raw, escapedLength } = buildOversizedAfterEscaping(caps.SPINE_NEXT_STEP_MAX)

  assert.ok(raw.length <= caps.SPINE_NEXT_STEP_MAX, 'the raw input must stay within the cap on its own')
  assert.ok(escapedLength > caps.SPINE_NEXT_STEP_MAX, 'escaping must be what pushes the value over its cap')

  const result = contributeToSpine(stored, { next_step: raw })

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected the escaped length, not the raw length, to trigger a refusal')
  }
  assert.equal(parseObservedFromMessage(result.message), escapedLength)
})

test('caps.refusal-is-complete', () => {
  const stored = baseSpine()
  const { raw, escapedLength } = buildOversizedAfterEscaping(caps.SPINE_NEXT_STEP_MAX)
  assert.notEqual(escapedLength, raw.length)

  const result = contributeToSpine(stored, { next_step: raw })

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected a refusal')
  }
  assert.equal(result.field, 'spine.next_step')
  assert.equal(result.retryable, true)
  assert.ok(result.accepted.length > 0)
  assert.ok(result.example.length > 0)
  assert.match(result.message, new RegExp(`cap of ${caps.SPINE_NEXT_STEP_MAX}`))
  assert.equal(parseObservedFromMessage(result.message), escapedLength)
  assert.match(result.message, /remedy:/)
})
