import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { controlledEnv, freshTmpDir, readFixture, runHookProcess } from './hook-process.ts'

test('hook.stop-survives-a-fresh-data-directory', () => {
  const home = freshTmpDir('logbook-stop-fresh-home-')
  const data = freshTmpDir('logbook-stop-fresh-data-')
  try {
    const event = readFixture('stop.json')
    const result = runHookProcess('stop', JSON.stringify(event), {
      env: controlledEnv({ HOME: home, CLAUDE_PLUGIN_DATA: data })
    })
    assert.equal(result.status, 0, `expected stop to exit 0 against a fresh empty CLAUDE_PLUGIN_DATA directory; stderr: ${result.stderr}`)
    assert.doesNotThrow(() => JSON.parse(result.stdout), `expected stop stdout to be valid JSON, got: ${result.stdout}`)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  }
})
