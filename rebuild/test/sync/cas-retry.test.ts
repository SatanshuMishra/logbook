import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { sync } from '../../src/merge/sync.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Teammate } from '../support/clone-fixture.ts'
import { withTwoClones } from '../support/clone-fixture.ts'

const layoutIn = (teammate: Teammate): StoreLayout => {
  const result = layoutFor(teammate.rt, teammate.repo)
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

const threadIsReachable = (rt: Runtime, repo: string, id: string): boolean =>
  git(rt, repo, ['cat-file', '-e', `${LEDGER_REF}:threads/${id}.json`]).ok

test('sync.cas-retry', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const pushA = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushA.ok, true)
    if (!pushA.ok) return
    assert.equal(pushA.action, 'pushed')

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)
    if (!fastForwardBen.ok) return
    assert.equal(fastForwardBen.action, 'fast-forwarded')

    const threadC = makeThread(ben.rt, 'thread-c')
    const createC = ben.store.commit([threadC], 'ben: create thread c')
    assert.equal(createC.ok, true)

    const pushC = sync(ben.rt, ben.store, benLayout)
    assert.equal(pushC.ok, true)
    if (!pushC.ok) return
    assert.equal(pushC.action, 'pushed')

    const threadB = makeThread(ana.rt, 'thread-b')
    const createB = ana.store.commit([threadB], 'ana: create thread b')
    assert.equal(createB.ok, true)

    const beforeRaceRef = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(beforeRaceRef.ok, true)
    if (!beforeRaceRef.ok) return
    const beforeRace = beforeRaceRef.stdout.trim()

    const threadDId = ana.rt.ulid()
    const threadDContent = JSON.stringify({
      id: threadDId,
      slug: 'thread-d',
      title: 'thread thread-d',
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
      created_at: ana.rt.now(),
      updated_at: ana.rt.now()
    })
    const recordPath = `threads/${threadDId}.json`

    const racerIndexDir = mkdtempSync(join(tmpdir(), 'logbook-racer-index-'))
    const racerIndexFile = join(racerIndexDir, 'index')

    let racerUpdateRefSucceeded = false

    const beforeCas = (): void => {
      const readTree = git(ana.rt, ana.repo, ['read-tree', beforeRace], { indexFile: racerIndexFile })
      assert.equal(readTree.ok, true, 'racer read-tree failed to seed the racing index')
      if (!readTree.ok) return

      const hash = git(ana.rt, ana.repo, ['hash-object', '-w', '--stdin'], { stdin: threadDContent })
      assert.equal(hash.ok, true, 'racer hash-object failed to write the racing blob')
      if (!hash.ok) return
      const blob = hash.stdout.trim()

      const addEntry = git(
        ana.rt,
        ana.repo,
        ['update-index', '--add', '--cacheinfo', `100644,${blob},${recordPath}`],
        { indexFile: racerIndexFile }
      )
      assert.equal(addEntry.ok, true, 'racer update-index failed to stage the racing entry')
      if (!addEntry.ok) return

      const writeTree = git(ana.rt, ana.repo, ['write-tree'], { indexFile: racerIndexFile })
      assert.equal(writeTree.ok, true, 'racer write-tree failed to build the racing tree')
      if (!writeTree.ok) return
      const tree = writeTree.stdout.trim()

      const commit = git(ana.rt, ana.repo, ['commit-tree', tree, '-p', beforeRace, '-m', 'racer moves the local ledger ref'])
      assert.equal(commit.ok, true, 'racer commit-tree failed to build the racing commit')
      if (!commit.ok) return
      const sha = commit.stdout.trim()

      const updateRef = git(ana.rt, ana.repo, ['update-ref', LEDGER_REF, sha, beforeRace])
      assert.equal(updateRef.ok, true, 'racer update-ref failed to move the local ledger ref underneath the writer')
      racerUpdateRefSucceeded = updateRef.ok
    }

    try {
      const mergeResult = sync(ana.rt, ana.store, anaLayout, { beforeCas })

      assert.equal(mergeResult.ok, true)
      if (!mergeResult.ok) return
      assert.equal(mergeResult.action, 'merged')

      assert.equal(racerUpdateRefSucceeded, true)

      assert.equal(threadIsReachable(ana.rt, ana.repo, threadA.record.id), true)
      assert.equal(threadIsReachable(ana.rt, ana.repo, threadB.record.id), true)
      assert.equal(threadIsReachable(ana.rt, ana.repo, threadC.record.id), true)
      assert.equal(threadIsReachable(ana.rt, ana.repo, threadDId), true)

      assert.equal(threadIsReachable(ben.rt, remote, threadA.record.id), true)
      assert.equal(threadIsReachable(ben.rt, remote, threadB.record.id), true)
      assert.equal(threadIsReachable(ben.rt, remote, threadC.record.id), true)
      assert.equal(threadIsReachable(ben.rt, remote, threadDId), true)
    } finally {
      rmSync(racerIndexDir, { recursive: true, force: true })
    }
  })
})
