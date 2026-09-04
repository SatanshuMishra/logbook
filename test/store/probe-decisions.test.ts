import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Decision } from '../../src/schema/decision.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { getRecordReadCounter, resetRecordReadCounter } from '../../src/store/read-path.ts'
import { getDecisionListingCounter, openStore, resetDecisionListingCounter, type Slot } from '../../src/store/records.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-probe-decisions-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const makeDecision = (rt: Runtime, threadId: string, title: string): Decision => ({
  id: rt.ulid(),
  thread_id: threadId,
  title,
  context: 'probe-decisions fixture context',
  options: ['an option'],
  outcome: 'the chosen outcome',
  commit: null,
  supersedes: [],
  created_at: rt.now()
})

const oldPerLinkLoop = (
  readDecision: (id: string) => Slot<Decision> | null,
  ids: readonly string[]
): { resolved: number; dangling: string[]; quarantined: string[] } => {
  const dangling: string[] = []
  const quarantined: string[] = []
  for (const id of ids) {
    const slot = readDecision(id)
    if (slot === null) dangling.push(id)
    else if (slot.quarantined) quarantined.push(id)
  }
  return { resolved: ids.length - dangling.length - quarantined.length, dangling, quarantined }
}

test('probe.matches-the-old-per-link-loop', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const threadId = rt.ulid()
      const resolvedOne = makeDecision(rt, threadId, 'resolved one')
      const resolvedTwo = makeDecision(rt, threadId, 'resolved two')
      const committed = store.commit(
        [
          { kind: 'decision', record: resolvedOne },
          { kind: 'decision', record: resolvedTwo }
        ],
        'seed resolving decisions'
      )
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      const quarantinedId = rt.ulid()
      writeFileSync(join(layout.value.records, 'decisions', `${quarantinedId}.json`), '{not-json', 'utf8')

      const danglingOne = rt.ulid()
      const danglingTwo = rt.ulid()

      const ids = [resolvedOne.id, danglingOne, resolvedTwo.id, quarantinedId, danglingTwo]

      const expected = oldPerLinkLoop(store.readDecision, ids)
      const actual = store.probeDecisions(ids)

      assert.deepEqual(actual, expected)
      assert.equal(actual.resolved, 2)
      assert.deepEqual(actual.dangling, [danglingOne, danglingTwo])
      assert.deepEqual(actual.quarantined, [quarantinedId])
    })
  })
})

test('probe.falls-back-to-per-id-reads-when-the-decisions-directory-cannot-be-listed', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const threadId = rt.ulid()
      const resolvedOne = makeDecision(rt, threadId, 'resolved one')
      const resolvedTwo = makeDecision(rt, threadId, 'resolved two')
      const committed = store.commit(
        [
          { kind: 'decision', record: resolvedOne },
          { kind: 'decision', record: resolvedTwo }
        ],
        'seed resolving decisions'
      )
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      const quarantinedId = rt.ulid()
      writeFileSync(join(layout.value.records, 'decisions', `${quarantinedId}.json`), '{not-json', 'utf8')

      const danglingOne = rt.ulid()
      const danglingTwo = rt.ulid()

      const ids = [resolvedOne.id, danglingOne, resolvedTwo.id, quarantinedId, danglingTwo]
      const decisionsDir = join(layout.value.records, 'decisions')

      chmodSync(decisionsDir, 0o111)
      try {
        const expected = oldPerLinkLoop(store.readDecision, ids)
        const actual = store.probeDecisions(ids)

        assert.deepEqual(actual, expected)
        assert.equal(actual.resolved, 2)
        assert.deepEqual(actual.dangling, [danglingOne, danglingTwo])
        assert.deepEqual(actual.quarantined, [quarantinedId])
      } finally {
        chmodSync(decisionsDir, 0o755)
      }
    })
  })
})

test('probe.missing-decisions-directory-yields-every-id-dangling', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      rmSync(join(layout.value.records, 'decisions'), { recursive: true, force: true })

      const ids = [rt.ulid(), rt.ulid()]
      const probe = store.probeDecisions(ids)
      assert.deepEqual(probe, { resolved: 0, dangling: ids, quarantined: [] })
    })
  })
})

test('probe.read-counter-counts-only-the-present-ids-a-per-link-loop-would-also-open', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const threadId = rt.ulid()
      const resolvedOne = makeDecision(rt, threadId, 'resolved one')
      const resolvedTwo = makeDecision(rt, threadId, 'resolved two')
      const committed = store.commit(
        [
          { kind: 'decision', record: resolvedOne },
          { kind: 'decision', record: resolvedTwo }
        ],
        'seed resolving decisions'
      )
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      const quarantinedId = rt.ulid()
      writeFileSync(join(layout.value.records, 'decisions', `${quarantinedId}.json`), '{not-json', 'utf8')

      const danglingOne = rt.ulid()
      const danglingTwo = rt.ulid()

      const ids = [resolvedOne.id, danglingOne, resolvedTwo.id, quarantinedId, danglingTwo]
      const presentCount = ids.filter((id) => id !== danglingOne && id !== danglingTwo).length

      resetRecordReadCounter()
      const oldLoopResult = oldPerLinkLoop(store.readDecision, ids)
      const oldLoopReadCount = getRecordReadCounter()

      resetRecordReadCounter()
      const probeResult = store.probeDecisions(ids)
      const probeReadCount = getRecordReadCounter()

      assert.deepEqual(probeResult, oldLoopResult)
      assert.equal(oldLoopReadCount, ids.length, 'the old per-link loop opens (or attempts to open) every linked file, dangling ones included')
      assert.equal(probeReadCount, presentCount, 'probeDecisions opens only the files the directory listing reports present')
    })
  })
})

test('probe.listing-counter-scales-with-total-store-size-not-with-the-link-count', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const threadId = rt.ulid()
      const decoys = Array.from({ length: 100 }, (_, index) => makeDecision(rt, threadId, `decoy decision ${index}`))
      const linkedOne = makeDecision(rt, threadId, 'linked one')
      const linkedTwo = makeDecision(rt, threadId, 'linked two')
      const allDecisions = [...decoys, linkedOne, linkedTwo]

      const committed = store.commit(
        allDecisions.map((record) => ({ kind: 'decision' as const, record })),
        'seed a store far larger than the thread it is probed for'
      )
      assert.equal(committed.ok, true)

      resetDecisionListingCounter()
      const probe = store.probeDecisions([linkedOne.id, linkedTwo.id])
      const listingCount = getDecisionListingCounter()

      assert.equal(probe.resolved, 2)
      assert.equal(
        listingCount,
        allDecisions.length,
        `expected the listing counter (${listingCount}) to equal the total decision count in the store (${allDecisions.length}), not the 2-id link count`
      )
    })
  })
})
