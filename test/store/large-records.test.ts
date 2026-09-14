import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import { commitThread } from '../../src/server/tool-support.ts'
import type { KeyDecision, Thread } from '../../src/schema/thread.ts'

const FORMER_THREAD_RECORD_SERIALISED_MAX_BYTES = 65536

const withStore = (fn: (store: Store, rt: Runtime) => void): void => {
  withRepo((repo) => {
    const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-large-records-data-'))
    const pluginData = join(pluginDataHome, 'plugin-data')
    mkdirSync(pluginData)
    try {
      const rt = testRuntime({
        env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData },
        cwd: repo
      })
      const opened = openStore(rt, repo)
      if (!opened.ok) {
        throw new Error(`large-records fixture: could not open the store: ${opened.message}`)
      }
      fn(opened.value, rt)
    } finally {
      rmSync(pluginDataHome, { recursive: true, force: true })
    }
  })
}

const baseThread = (rt: Runtime): Thread => ({
  id: rt.ulid(),
  slug: 'large-records-fixture',
  title: 'large records fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'prove a thread record past the former byte cap is stored',
    next_step: 'read the record back',
    landed: '',
    last_session: 'none',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const longEntry = (rt: Runtime): KeyDecision => ({
  id: rt.ulid(),
  decision_id: rt.ulid(),
  title: 't'.repeat(200),
  scope: 'c'.repeat(200)
})

test('large-records.a-thread-record-past-the-former-byte-cap-commits-and-reads-back', () => {
  withStore((store, rt) => {
    const base = baseThread(rt)
    const large: Thread = {
      ...base,
      spine: { ...base.spine, key_decisions: Array.from({ length: 200 }, () => longEntry(rt)) }
    }
    const observed = Buffer.byteLength(JSON.stringify(large), 'utf8')
    assert.ok(
      observed > FORMER_THREAD_RECORD_SERIALISED_MAX_BYTES,
      `the fixture must exceed the former whole-record byte cap; observed ${observed}`
    )

    const attempt = commitThread(store, large, 'large record probe')
    assert.equal(attempt.ok, true, 'a thread record past the former byte cap must commit')

    const slot = store.readThread(large.id)
    if (slot === null || slot.quarantined) {
      assert.fail('the committed thread record must read back without being quarantined')
    }
    assert.equal(slot.record.spine.key_decisions.length, 200)
  })
})
