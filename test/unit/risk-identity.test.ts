import assert from 'node:assert/strict'
import { test } from 'node:test'
import { liveRiskIdsByIdentity, normalisedRiskText, riskIdentity } from '../../src/domain/risk-identity.ts'
import { escapeStored } from '../../src/render/escape.ts'
import type { Risk } from '../../src/schema/thread.ts'

const NEXT_LINE = String.fromCodePoint(0x85)
const ZERO_WIDTH_NO_BREAK_SPACE = String.fromCodePoint(0xfeff)

const riskWith = (id: string, text: string, retired: boolean): Risk => ({
  id,
  scope: 'identity',
  text: escapeStored(text),
  refs: [],
  criterion_id: null,
  retired
})

test('risk-identity.collapses-a-unicode-white-space-character-javascript-does-not-match', () => {
  assert.equal(normalisedRiskText(escapeStored(`retry${NEXT_LINE}storm`)), 'retry storm')
  assert.equal(normalisedRiskText(escapeStored(`${NEXT_LINE}retry storm${NEXT_LINE}`)), 'retry storm')
})

test('risk-identity.keeps-a-character-javascript-counts-as-space-but-unicode-does-not', () => {
  assert.equal(
    normalisedRiskText(escapeStored(`retry${ZERO_WIDTH_NO_BREAK_SPACE}storm`)),
    `retry${ZERO_WIDTH_NO_BREAK_SPACE}storm`
  )
  assert.equal(
    normalisedRiskText(escapeStored(`${ZERO_WIDTH_NO_BREAK_SPACE}retry storm`)),
    `${ZERO_WIDTH_NO_BREAK_SPACE}retry storm`
  )
})

const RETIRED_RISK_ID = '01M2HH0000000000000000000A'
const FIRST_LIVE_RISK_ID = '01M2HH0000000000000000000B'
const SECOND_LIVE_RISK_ID = '01M2HH0000000000000000000C'

test('risk-identity.live-risk-ids-by-identity-returns-the-first-live-risk-in-stored-order', () => {
  const byIdentity = liveRiskIdsByIdentity([
    riskWith(RETIRED_RISK_ID, 'the queue may starve', true),
    riskWith(FIRST_LIVE_RISK_ID, 'The queue  may starve', false),
    riskWith(SECOND_LIVE_RISK_ID, 'the QUEUE may starve', false)
  ])

  assert.equal(byIdentity.size, 1, 'three spellings of one risk on one anchor are one identity')
  assert.equal(
    byIdentity.get(riskIdentity(null, escapeStored('the queue may starve'))),
    FIRST_LIVE_RISK_ID,
    'a retired risk never matches, and of two live risks with one identity the first in stored order is returned'
  )
})
