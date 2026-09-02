import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-shape-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('hook.stop-gate-leaves-no-half-built-store', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })

      const verdict = stopGateVerdict(rt, {
        session_id: 'stop-gate-shape-session',
        cwd: repo,
        transcript_path: join(pluginData, 'no-such-transcript.jsonl'),
        stop_hook_active: false
      })
      assert.equal(verdict.kind, 'silent')

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return

      assert.equal(
        existsSync(join(layout.value.state, 'stop-gate.json')),
        true,
        'the stop gate must still write its own state file'
      )
      assert.equal(
        existsSync(layout.value.records),
        false,
        'the stop gate must not leave a records directory it never materialised'
      )
      assert.equal(
        existsSync(join(layout.value.state, 'origin.json')),
        false,
        'the stop gate must not claim a store root it never materialised'
      )
    })
  })
})
