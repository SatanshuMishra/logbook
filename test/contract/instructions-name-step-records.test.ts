import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INSTRUCTIONS } from '../../src/server/instructions.ts'

test('instructions.name-next-step-records-and-search-ledger-within-2048-bytes', () => {
  assert.ok(
    INSTRUCTIONS.includes('next_step_records'),
    'the server instructions do not mention next_step_records'
  )
  assert.ok(
    INSTRUCTIONS.includes('search_ledger'),
    'the server instructions do not mention search_ledger'
  )
  assert.ok(
    !INSTRUCTIONS.includes('running summary'),
    'the server instructions still describe park_thread as refreshing a running summary'
  )
  assert.ok(
    !INSTRUCTIONS.includes('Omit outcome and park_thread only releases'),
    'the server instructions still carry the old omit-outcome phrasing'
  )
  assert.ok(
    Buffer.byteLength(INSTRUCTIONS, 'utf8') < 2048,
    `the server instructions must stay under 2048 bytes, got ${Buffer.byteLength(INSTRUCTIONS, 'utf8')}`
  )
})
