import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { git } from '../../src/store/git.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { writeRecords } from '../../src/store/write-path.ts'
import { readPointer, writePointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-pointer-store-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const layoutIn = (rt: Runtime, repo: string): StoreLayout => {
  const result = layoutFor(rt, repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
  return result.value
}

test('pointer.is-never-committed', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const threadId = rt.ulid()
      writePointer(rt, layout, { thread_id: threadId, written_at: rt.now(), session_id: 'store-session' })

      const change = {
        kind: 'thread' as const,
        record: {
          id: rt.ulid(),
          slug: 'pointer-commit-check',
          title: 'pointer commit check',
          status: 'open' as const,
          blocked_by: null,
          completion_criteria: [],
          spine: {
            active_goal: 'goal',
            next_step: 'next',
            last_session: 'last',
            open_risks: [],
            key_decisions: [],
            out_of_scope: []
          },
          created_at: rt.now(),
          updated_at: rt.now()
        }
      }
      const commitResult = writeRecords(rt, layout, [change], 'record a thread while a pointer is set')
      assert.equal(commitResult.ok, true)

      const listing = git(rt, repo, ['ls-tree', '-r', '--name-only', LEDGER_REF])
      assert.equal(listing.ok, true)
      if (!listing.ok) return
      const paths = listing.stdout.trim().split('\n').filter((line) => line.length > 0)
      assert.ok(paths.length > 0)
      assert.ok(paths.every((entry) => !entry.startsWith('state/')))
      assert.ok(paths.every((entry) => !entry.includes('active-thread.json')))

      assert.ok(existsSync(join(layout.state, 'active-thread.json')), 'expected the pointer file to still be present on disk after the commit')

      const pointerAfterCommit = readPointer(rt, layout)
      assert.equal(pointerAfterCommit.kind, 'pointer')
      if (pointerAfterCommit.kind === 'pointer') {
        assert.equal(pointerAfterCommit.value.thread_id, threadId)
      }
    })
  })
})
