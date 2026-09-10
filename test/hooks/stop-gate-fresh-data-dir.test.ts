import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { controlledEnv, freshPluginDataDir, freshTmpDir, readFixture, runHookProcess } from './hook-process.ts'

const GATE_FILE_NAME = 'stop-gate.json'

const findFileBeneath = (root: string, fileName: string): string | null => {
  if (!existsSync(root)) return null
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      const found = findFileBeneath(full, fileName)
      if (found !== null) return found
    } else if (entry.isFile() && entry.name === fileName) {
      return full
    }
  }
  return null
}

test('hook.stop-survives-a-fresh-data-directory', () => {
  const home = freshTmpDir('logbook-stop-fresh-home-')
  const { home: dataHome, root: data } = freshPluginDataDir('logbook-stop-fresh-data-')
  const cwd = freshTmpDir('logbook-stop-fresh-cwd-')
  try {
    const event = {
      ...(readFixture('stop.json') as object),
      cwd,
      transcript_path: path.join(cwd, 'no-such-transcript.jsonl')
    }
    const result = runHookProcess('stop', JSON.stringify(event), {
      env: controlledEnv({ HOME: home, CLAUDE_PLUGIN_DATA: data })
    })
    assert.equal(result.status, 0, `expected stop to exit 0 against a fresh empty CLAUDE_PLUGIN_DATA directory; stderr: ${result.stderr}`)
    assert.doesNotThrow(() => JSON.parse(result.stdout), `expected stop stdout to be valid JSON, got: ${result.stdout}`)

    const dataEntries = existsSync(data) ? readdirSync(data) : []
    assert.equal(
      dataEntries.length,
      0,
      `expected CLAUDE_PLUGIN_DATA directory ${data} to remain empty after a stop run whose transcript carries no resume briefing, since a hook that examined nothing must record no verdict`
    )

    const gatePath = findFileBeneath(data, GATE_FILE_NAME)
    assert.equal(
      gatePath,
      null,
      `expected no ${GATE_FILE_NAME} file anywhere beneath CLAUDE_PLUGIN_DATA directory ${data}: this fixture's transcript carries no resume briefing, so the hook performed no verbatim comparison and must not record a verdict for one`
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(dataHome, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }
})
