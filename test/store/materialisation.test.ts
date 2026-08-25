import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { getMaterialiseCallCounter, resetMaterialiseCallCounter } from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const STAMP_FILE_NAME = 'last-materialised'
const LEGACY_STAMP_FILE_NAME = 'last-synced'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-materialisation-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const layoutIn = (rt: Runtime, repo: string): StoreLayout => {
  const result = layoutFor(rt, repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
  return result.value
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

const anyStampPresent = (layout: StoreLayout): boolean =>
  existsSync(join(layout.state, STAMP_FILE_NAME)) || existsSync(join(layout.state, LEGACY_STAMP_FILE_NAME))

const stampPathInUse = (layout: StoreLayout): string => {
  const current = join(layout.state, STAMP_FILE_NAME)
  return existsSync(current) ? current : join(layout.state, LEGACY_STAMP_FILE_NAME)
}

const pointLedgerRefAtABlob = (rt: Runtime, repo: string): void => {
  const blob = git(rt, repo, ['hash-object', '-w', '--stdin'], { stdin: 'not a tree' })
  assert.equal(blob.ok, true, 'fixture could not write the blob the ledger ref is pointed at')
  if (!blob.ok) return
  const updated = git(rt, repo, ['update-ref', LEDGER_REF, blob.stdout.trim()])
  assert.equal(updated.ok, true, 'fixture could not point the ledger ref at a blob')
}

test('read.failed-materialisation-leaves-no-stamp', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)
      mkdirSync(layout.state, { recursive: true })

      pointLedgerRefAtABlob(rt, repo)

      resetMaterialiseCallCounter()
      const first = openStore(rt, repo)
      assert.equal(first.ok, false, 'a store whose ledger tree cannot be listed must not open silently')
      assert.equal(getMaterialiseCallCounter() > 0, true, 'the first open must have attempted to materialise')
      assert.equal(
        anyStampPresent(layout),
        false,
        'a failed materialisation must leave no stamp under either the current or the pre-rename filename'
      )

      resetMaterialiseCallCounter()
      const second = openStore(rt, repo)
      assert.equal(second.ok, false)
      assert.equal(
        getMaterialiseCallCounter() > 0,
        true,
        'the next open must re-attempt materialisation rather than short-circuit on a stamp'
      )
      assert.equal(anyStampPresent(layout), false)
    })
  })
})

test('read.absent-records-under-a-current-stamp-are-reported', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const seedRt = runtimeWithHome(pluginData)
      const seeded = openStore(seedRt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return
      const thread = makeThread(seedRt, 'stamp-outlives-its-records')
      const committed = seeded.value.commit([thread], 'seed one thread')
      assert.equal(committed.ok, true)

      const layout = layoutIn(seedRt, repo)
      const tip = git(seedRt, repo, ['rev-parse', LEDGER_REF])
      assert.equal(tip.ok, true)
      if (!tip.ok) return
      const stampBefore = readFileSync(stampPathInUse(layout), 'utf8').trim()
      assert.equal(stampBefore, tip.stdout.trim(), 'the fixture requires a stamp naming the current tip')

      rmSync(layout.records, { recursive: true, force: true })
      mkdirSync(layout.records, { recursive: true })

      const events: Record<string, unknown>[] = []
      const watchRt: Runtime = { ...seedRt, log: (record) => { events.push(record) } }

      const reopened = openStore(watchRt, repo)
      assert.equal(reopened.ok, true, 'a store whose records vanished under a current stamp must still open')
      if (!reopened.ok) return

      const anomalies = events.filter((record) => record.event === 'store.materialisation-anomaly')
      assert.equal(
        anomalies.length,
        1,
        'a store holding none of the records the ledger ref carries must report a named anomaly, never silence'
      )
      assert.equal(anomalies[0]?.records_in_ref, 1)
      assert.equal(anomalies[0]?.records_on_disk, 0)
    })
  })
})

test('read.a-pre-rename-stamp-still-opens', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return
      const thread = makeThread(rt, 'legacy-stamp-thread')
      const committed = seeded.value.commit([thread], 'seed one thread')
      assert.equal(committed.ok, true)

      const layout = layoutIn(rt, repo)
      const legacy = join(layout.state, LEGACY_STAMP_FILE_NAME)
      const inUse = stampPathInUse(layout)
      if (inUse !== legacy) renameSync(inUse, legacy)
      assert.equal(existsSync(legacy), true, 'the fixture requires a stamp under the pre-rename filename')
      assert.equal(existsSync(join(layout.state, STAMP_FILE_NAME)), false)

      resetMaterialiseCallCounter()
      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true, 'a store carrying only the pre-rename stamp must still open')
      if (!reopened.ok) return
      assert.equal(reopened.value.readThreads().length, 1)
      assert.equal(
        getMaterialiseCallCounter(),
        0,
        'the pre-rename stamp must be read and honoured, not ignored into a rebuild'
      )
    })
  })
})

test('read.a-record-blob-that-cannot-be-read-is-a-failure', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)
      mkdirSync(layout.state, { recursive: true })

      const missingBlob = 'a'.repeat(40)
      const innerTree = git(rt, repo, ['mktree', '--missing'], { stdin: `100644 blob ${missingBlob}\tabsent.json\n` })
      assert.equal(innerTree.ok, true, 'fixture could not build a subtree naming a blob that does not exist')
      if (!innerTree.ok) return

      const outerTree = git(rt, repo, ['mktree'], { stdin: `040000 tree ${innerTree.stdout.trim()}\tthreads\n` })
      assert.equal(outerTree.ok, true, 'fixture could not build the tree that carries the unreadable record')
      if (!outerTree.ok) return

      const commit = git(rt, repo, ['commit-tree', outerTree.stdout.trim(), '-m', 'a tree naming an absent blob'])
      assert.equal(commit.ok, true)
      if (!commit.ok) return
      const updated = git(rt, repo, ['update-ref', LEDGER_REF, commit.stdout.trim()])
      assert.equal(updated.ok, true)

      const opened = openStore(rt, repo)
      assert.equal(opened.ok, false, 'a partial materialisation must not be reported as a materialised store')
      assert.equal(
        anyStampPresent(layout),
        false,
        'a partial materialisation must leave no stamp claiming the tree was materialised'
      )
    })
  })
})
