import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { getRecordReadCounter, resetRecordReadCounter } from '../../src/store/read-path.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import type { Thread } from '../../src/schema/thread.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { paginateRoster, renderRoster, selectRosterThreads, toRosterRow } from '../../src/render/roster.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const RESUMABLE_CACHE_FILE_NAME = 'resumable.json'
const OPEN_THREAD_COUNT = 3
const SMALL_TERMINAL_COUNT = 20
const LARGE_TERMINAL_COUNT = SMALL_TERMINAL_COUNT * 10

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-resumable-cost-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const makeThread = (rt: Runtime, slug: string, status: Thread['status']): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: `resumable-cost thread ${slug}`,
    status,
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

const seedTerminalAndOpen = (
  rt: Runtime,
  store: Store,
  terminalCount: number,
  openCount: number
): void => {
  const changes: RecordChange[] = []
  for (let index = 0; index < terminalCount; index += 1) {
    changes.push(makeThread(rt, `terminal-${index}`, index % 2 === 0 ? 'done' : 'abandoned'))
  }
  for (let index = 0; index < openCount; index += 1) {
    changes.push(makeThread(rt, `open-${index}`, 'open'))
  }
  const committed = store.commit(changes, `seed ${terminalCount} terminal and ${openCount} open threads`)
  assert.equal(committed.ok, true, 'expected the seeding commit to succeed')
}

const readsForFirstRosterRead = (terminalCount: number, openCount: number): number =>
  withRepo((repo) =>
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) throw new Error('expected the store to open')

      seedTerminalAndOpen(rt, opened.value, terminalCount, openCount)

      resetRecordReadCounter()
      const { resumable } = opened.value.readResumable()
      assert.equal(
        resumable.length,
        openCount,
        `expected the resumable roster to hold exactly the ${openCount} open threads`
      )

      return getRecordReadCounter()
    })
  )

test('resumable.record-reads-do-not-grow-with-terminal-thread-count', () => {
  const small = readsForFirstRosterRead(SMALL_TERMINAL_COUNT, OPEN_THREAD_COUNT)
  const large = readsForFirstRosterRead(LARGE_TERMINAL_COUNT, OPEN_THREAD_COUNT)

  assert.equal(
    small,
    large,
    `reading the roster over ${SMALL_TERMINAL_COUNT} terminal threads read ${small} records and over ${LARGE_TERMINAL_COUNT} terminal threads read ${large}; the read count must not grow with terminal thread count`
  )
  assert.equal(
    small,
    OPEN_THREAD_COUNT,
    `expected the roster read to cost exactly the ${OPEN_THREAD_COUNT} open-thread reads, not fewer`
  )
})

const renderRosterFromStore = (store: Store): string => {
  const { resumable, terminal } = store.readResumable()
  const selected = selectRosterThreads(resumable)
  const rows = selected.map(toRosterRow)
  const paginated = paginateRoster(rows, null, Math.max(rows.length, 1))
  assert.equal(paginated.ok, true)
  if (!paginated.ok) throw new Error('expected pagination to succeed')
  return renderRoster(paginated.page, terminal)
}

test('resumable.cache-absent-renders-the-same-roster-as-warm', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return

      seedTerminalAndOpen(rt, opened.value, SMALL_TERMINAL_COUNT, OPEN_THREAD_COUNT)

      const warm = renderRosterFromStore(opened.value)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      unlinkSync(join(layout.value.state, RESUMABLE_CACHE_FILE_NAME))

      const cold = renderRosterFromStore(opened.value)
      assert.equal(cold, warm, 'expected the roster rendered with a missing cache to match the warm rendering byte for byte')
    })
  })
})

test('resumable.cache-corrupt-renders-the-same-roster-as-warm', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return

      seedTerminalAndOpen(rt, opened.value, SMALL_TERMINAL_COUNT, OPEN_THREAD_COUNT)

      const warm = renderRosterFromStore(opened.value)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      writeFileSync(join(layout.value.state, RESUMABLE_CACHE_FILE_NAME), 'not-json{{{', 'utf8')

      const corrupted = renderRosterFromStore(opened.value)
      assert.equal(
        corrupted,
        warm,
        'expected the roster rendered with a corrupt cache to match the warm rendering byte for byte'
      )
    })
  })
})

const rebuiltResumableIds = (store: Store): Set<string> => {
  const slots = store.readThreads()
  const threads = slots.flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
  return new Set(selectRosterThreads(threads).map((thread) => thread.id))
}

test('resumable.cache-matches-a-full-rebuild-through-a-long-sequence-of-commits', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const threadIds: string[] = []

      const openOne = (slug: string): void => {
        const change = makeThread(rt, slug, 'open')
        threadIds.push(change.record.id)
        const result = store.commit([change], `open ${slug}`)
        assert.equal(result.ok, true)
      }

      const updateOne = (id: string, slug: string): void => {
        const slot = store.readThread(id)
        assert.ok(slot !== null && !slot.quarantined)
        if (slot === null || slot.quarantined) return
        const updated: RecordChange = {
          kind: 'thread',
          record: { ...slot.record, updated_at: rt.now(), spine: { ...slot.record.spine, next_step: `updated ${slug}` } }
        }
        const result = store.commit([updated], `update ${slug}`)
        assert.equal(result.ok, true)
      }

      const closeOne = (id: string, slug: string, status: 'done' | 'abandoned'): void => {
        const slot = store.readThread(id)
        assert.ok(slot !== null && !slot.quarantined)
        if (slot === null || slot.quarantined) return
        const closed: RecordChange = { kind: 'thread', record: { ...slot.record, status, updated_at: rt.now() } }
        const result = store.commit([closed], `close ${slug}`)
        assert.equal(result.ok, true)
      }

      const assertCacheMatchesRebuild = (label: string): void => {
        const { resumable } = store.readResumable()
        const fromCache = new Set(resumable.map((thread) => thread.id))
        const fromRebuild = rebuiltResumableIds(store)
        assert.deepEqual(
          [...fromCache].sort(),
          [...fromRebuild].sort(),
          `after ${label}, the resumable cache disagreed with a full rebuild`
        )
      }

      openOne('seq-a')
      assertCacheMatchesRebuild('opening seq-a')

      openOne('seq-b')
      assertCacheMatchesRebuild('opening seq-b')

      updateOne(threadIds[0] as string, 'seq-a')
      assertCacheMatchesRebuild('updating seq-a')

      closeOne(threadIds[0] as string, 'seq-a', 'done')
      assertCacheMatchesRebuild('closing seq-a as done')

      openOne('seq-c')
      assertCacheMatchesRebuild('opening seq-c')

      updateOne(threadIds[1] as string, 'seq-b')
      assertCacheMatchesRebuild('updating seq-b')

      closeOne(threadIds[1] as string, 'seq-b', 'abandoned')
      assertCacheMatchesRebuild('closing seq-b as abandoned')

      closeOne(threadIds[2] as string, 'seq-c', 'done')
      assertCacheMatchesRebuild('closing seq-c as done')
    })
  })
})
