import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { census } from '../support/census.ts'
import {
  buildControlledEnv,
  classifyChildEnvKey,
  CONTROLLED_ENV_KEYS,
  spawnServer,
  spawnTransport
} from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const JSON_RPC_FRAMING_PATTERN = /"jsonrpc"\s*:\s*"2\.0"/

test('server.spawn-handshake', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const listed = await spawned.client.listTools()
    assert.ok(Array.isArray(listed.tools))
    assert.deepEqual(listed.tools, [])
    assert.doesNotMatch(spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  } finally {
    await spawned.close()
  }
})

test('server.spawn-handshake.controlled-environment', async () => {
  const entryDir = mkdtempSync(join(tmpdir(), 'logbook-env-report-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-env-report-home-'))
  try {
    const reporterPath = join(entryDir, 'reporter.ts')
    writeFileSync(
      reporterPath,
      [
        "import { writeSync } from 'node:fs'",
        'writeSync(2, JSON.stringify({ keys: Object.keys(process.env).sort(), home: process.env.HOME }))'
      ].join('\n'),
      'utf8'
    )

    const { transport, stderr } = spawnTransport({
      command: process.execPath,
      args: [reporterPath],
      cwd: PROJECT_ROOT,
      env: buildControlledEnv(homeDir)
    })

    const closed = new Promise<void>((resolve) => {
      transport.onclose = () => resolve()
    })
    await transport.start()
    await closed
    await transport.close()

    const report = JSON.parse(stderr()) as { keys: string[]; home: string }
    assert.equal(report.home, homeDir)
    assert.doesNotThrow(() => census(report.keys, classifyChildEnvKey))
  } finally {
    rmSync(entryDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('server.spawn-handshake.controlled-environment.control.unexpected-key-is-forbidden', () => {
  const withRogueKey = [...CONTROLLED_ENV_KEYS, 'SSH_AUTH_SOCK']
  assert.throws(() => census(withRogueKey, classifyChildEnvKey))
})
