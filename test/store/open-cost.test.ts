import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { getRecordScanCounter, openStore, resetRecordScanCounter } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const RECORDS_MODULE_PATH = fileURLToPath(new URL('../../src/store/records.ts', import.meta.url))
const RUNTIME_MODULE_PATH = fileURLToPath(new URL('../support/runtime.ts', import.meta.url))
const DESCENT_DEPTH = 100
const LOWERED_FD_LIMIT = 40

const SEEDED_RECORD_COUNT = 40
const RECORD_SCAN_CEILING = 8
const FEW_RECORD_COUNT = 4
const MANY_RECORD_COUNT = 40

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-open-cost-'))
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
    title: `thread ${slug}`,
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

const childProbeSource = (): string => `
import { openStore } from '${RECORDS_MODULE_PATH}'
import { testRuntime } from '${RUNTIME_MODULE_PATH}'

const repo = process.argv[2]
const pluginData = process.argv[3]
const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })
const result = openStore(rt, repo)
if (!result.ok) {
  console.error('refusal: ' + JSON.stringify(result))
  process.exit(2)
}
console.log('opened ok')
process.exit(0)
`

test('store.open-does-not-hold-one-handle-per-descent-level', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return

      let deepest = layout.value.records
      for (let level = 0; level < DESCENT_DEPTH; level += 1) {
        deepest = join(deepest, `d${level}`)
      }
      mkdirSync(deepest, { recursive: true })
      writeFileSync(join(deepest, 'buried.json'), '{}', 'utf8')

      const childHome = mkdtempSync(join(tmpdir(), 'logbook-open-cost-descent-'))
      try {
        const childScript = join(childHome, 'probe.mjs')
        writeFileSync(childScript, childProbeSource(), 'utf8')

        const spawned = spawnSync(
          'sh',
          ['-c', 'ulimit -n "$1" && exec node "$2" "$3" "$4"', 'sh', String(LOWERED_FD_LIMIT), childScript, repo, pluginData],
          { encoding: 'utf8' }
        )

        assert.equal(
          spawned.status,
          0,
          `opening a store whose records tree descends ${DESCENT_DEPTH} levels deep, under a lowered file-descriptor limit of ${LOWERED_FD_LIMIT}, exited ${spawned.status} instead of 0. stderr: ${spawned.stderr}`
        )
        assert.match(spawned.stdout, /opened ok/)
      } finally {
        rmSync(childHome, { recursive: true, force: true })
      }
    })
  })
})
