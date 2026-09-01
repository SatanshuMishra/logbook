import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawnServer } from '../support/spawn-client.ts'
import { BUDGET_BYTES } from '../support/published.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const REQUIRED_PHRASES = [
  'Any agent holding a thread id records against it, a subagent included',
  'subagent boundary is preferred to carrying the material back',
  'subagent records what it established, and a selection between live options is recorded by',
  'whoever selected.'
]

test('contract.published-instructions-carry-the-subagent-recording-guidance', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const instructions = spawned.instructions()
    assert.notEqual(instructions, undefined, 'the server published no instructions at all')
    const text = instructions as string
    for (const phrase of REQUIRED_PHRASES) {
      assert.ok(
        text.includes(phrase),
        `the published server instructions do not carry the phrase ${JSON.stringify(phrase)}`
      )
    }
    assert.ok(
      Buffer.byteLength(text, 'utf8') < BUDGET_BYTES,
      `the published instructions must stay under ${BUDGET_BYTES} bytes, got ${Buffer.byteLength(text, 'utf8')}`
    )
  } finally {
    await spawned.close()
  }
})
