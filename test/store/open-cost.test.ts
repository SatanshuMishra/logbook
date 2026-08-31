import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { getRecordScanCounter, openStore, resetRecordScanCounter } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SEEDED_RECORD_COUNT = 40
const RECORD_SCAN_CEILING = 8
const FEW_RECORD_COUNT = 4
const MANY_RECORD_COUNT = 40

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-open-cost-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: `thread ${slug}`,
    status: 'open',
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
})

test('store.open-does-not-read-every-record', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return

      const changes: RecordChange[] = []
      for (let index = 0; index < SEEDED_RECORD_COUNT; index += 1) {
        changes.push(makeThread(rt, `open-cost-${index}`))
      }
      const committed = seeded.value.commit(changes, `seed ${SEEDED_RECORD_COUNT} threads`)
      assert.equal(committed.ok, true)

      resetRecordScanCounter()

      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) return
      assert.equal(reopened.value.readThreads().length, SEEDED_RECORD_COUNT)

      assert.equal(
        getRecordScanCounter() <= RECORD_SCAN_CEILING,
        true,
        `opening a store holding ${SEEDED_RECORD_COUNT} records examined ${getRecordScanCounter()} directory entries, above the ceiling of ${RECORD_SCAN_CEILING}`
      )
    })
  })
})

const recordScansFor = (recordCount: number): number =>
  withRepo((repo) =>
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) throw new Error('expected the seeding open to succeed')

      const changes: RecordChange[] = Array.from({ length: recordCount }, (_, index) =>
        makeThread(rt, `open-directory-scan-${index}`)
      )
      const committed = seeded.value.commit(changes, `seed ${recordCount} threads`)
      assert.equal(committed.ok, true)

      resetRecordScanCounter()

      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) throw new Error('expected the reopening open to succeed')
      assert.equal(reopened.value.readThreads().length, recordCount)

      return getRecordScanCounter()
    })
  )

test('store.open-directory-scan-does-not-grow-with-record-count', () => {
  const few = recordScansFor(FEW_RECORD_COUNT)
  const many = recordScansFor(MANY_RECORD_COUNT)

  assert.equal(
    few,
    many,
    `opening a store holding ${FEW_RECORD_COUNT} records examined ${few} directory entries and opening one holding ${MANY_RECORD_COUNT} records examined ${many}; the number of directory entries examined must not depend on how many records the store holds`
  )
})
