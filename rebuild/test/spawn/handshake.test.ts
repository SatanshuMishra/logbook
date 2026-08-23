import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const JSON_RPC_FRAMING_PATTERN = /"jsonrpc"\s*:\s*"2\.0"/

test('server.spawn-handshake', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const listed = await spawned.client.listTools()
    assert.ok(Array.isArray(listed.tools))
    assert.doesNotMatch(spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  } finally {
    await spawned.close()
  }
})
