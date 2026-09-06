import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { getSubprocessCallCounter, resetSubprocessCallCounter } from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { selectRosterThreads, toRosterRow } from '../../src/render/roster.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const THREAD_COUNT = 50

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-roster-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: `roster thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      landed: '',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

test('roster.is-subprocess-free', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const changes = Array.from({ length: THREAD_COUNT }, (_, index) => makeThread(rt, `roster-subprocess-${index}`))

      const seeding = openStore(rt, repo)
      assert.equal(seeding.ok, true)
      if (!seeding.ok) return
      const commitResult = seeding.value.commit(changes, 'seed fifty threads for the roster subprocess census')
      assert.equal(commitResult.ok, true)

      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return

      resetSubprocessCallCounter()

      const slots = opened.value.readThreads()
      const threads = slots.flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
      assert.equal(threads.length, THREAD_COUNT)
      const rows = selectRosterThreads(threads).map(toRosterRow)
      assert.equal(rows.length, THREAD_COUNT)

      assert.ok(
        getSubprocessCallCounter() <= 1,
        `expected the whole roster read over ${THREAD_COUNT} threads to cost at most one subprocess, counted ${getSubprocessCallCounter()}`
      )
    })
  })
})
