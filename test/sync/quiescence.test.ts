import assert from 'node:assert/strict'
import { test } from 'node:test'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
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

const remoteRef = (rt: Runtime, remote: string): string => {
  const result = git(rt, remote, ['rev-parse', 'refs/logbook/ledger'])
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the remote ledger ref to resolve')
  return result.stdout.trim()
}

const remoteCommitCount = (rt: Runtime, remote: string): number => {
  const result = git(rt, remote, ['rev-list', '--count', 'refs/logbook/ledger'])
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the remote ledger ref history to be countable')
  return Number.parseInt(result.stdout.trim(), 10)
}

test('sync.merge-quiesces-and-advances-merge-base', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const firstPush = sync(ana.rt, ana.store, anaLayout)
    assert.equal(firstPush.ok, true)
    if (!firstPush.ok) return
    assert.equal(firstPush.action, 'pushed')

    const rootCommit = remoteRef(ana.rt, remote)

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)

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

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)
    assert.equal(mergeOutcome.ok, true)
    if (!mergeOutcome.ok) return
    assert.equal(mergeOutcome.action, 'merged')

    const remoteAfterMerge = remoteRef(ana.rt, remote)
    assert.notEqual(remoteAfterMerge, rootCommit)

    const mergeBaseResult = git(ana.rt, ana.repo, ['merge-base', 'refs/logbook/ledger', remoteAfterMerge])
    assert.equal(mergeBaseResult.ok, true)
    if (!mergeBaseResult.ok) return
    assert.notEqual(mergeBaseResult.stdout.trim(), rootCommit)

    const commitCountAfterMerge = remoteCommitCount(ana.rt, remote)

    for (let round = 0; round < 3; round += 1) {
      const benSync = sync(ben.rt, ben.store, benLayout)
      assert.equal(benSync.ok, true)
      if (!benSync.ok) return
      assert.notEqual(benSync.action, 'merged')

      const anaSync = sync(ana.rt, ana.store, anaLayout)
      assert.equal(anaSync.ok, true)
      if (!anaSync.ok) return
      assert.notEqual(anaSync.action, 'merged')

      assert.equal(remoteRef(ana.rt, remote), remoteAfterMerge)
      assert.equal(remoteCommitCount(ana.rt, remote), commitCountAfterMerge)
    }

    const finalAnaIdle = sync(ana.rt, ana.store, anaLayout)
    assert.equal(finalAnaIdle.ok, true)
    if (!finalAnaIdle.ok) return
    assert.equal(finalAnaIdle.action, 'noop')

    const finalBenIdle = sync(ben.rt, ben.store, benLayout)
    assert.equal(finalBenIdle.ok, true)
    if (!finalBenIdle.ok) return
    assert.equal(finalBenIdle.action, 'noop')
  })
})
