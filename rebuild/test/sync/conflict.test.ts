import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

const makeThread = (rt: Runtime, slug: string): RecordChange => ({
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
      next_step: 'original next step',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

test('sync.offline-is-an-error', () => {
  withTwoClones((ana, _ben, _remote) => {
    const layout = layoutIn(ana)

    ana.goOffline()

    const result = sync(ana.rt, ana.store, layout)

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reason, 'offline')
    assert.match(result.detail, /origin/)
  })
})

test('sync.conflict-refuses', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const original = makeThread(ana.rt, 'shared-thread')
    const created = ana.store.commit([original], 'ana: create shared thread')
    assert.equal(created.ok, true)

    const firstAnaSync = sync(ana.rt, ana.store, anaLayout)
    assert.equal(firstAnaSync.ok, true)

    const firstBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(firstBenSync.ok, true)
    if (!firstBenSync.ok) return
    assert.equal(firstBenSync.action, 'fast-forwarded')

    const benSlot = ben.store.readThread(original.record.id)
    assert.ok(benSlot !== null && !benSlot.quarantined)
    if (benSlot === null || benSlot.quarantined) return
    const benEdit: RecordChange = {
      kind: 'thread',
      record: {
        ...benSlot.record,
        spine: { ...benSlot.record.spine, next_step: 'ben changed the next step' },
        updated_at: ben.rt.now()
      }
    }
    const benCommit = ben.store.commit([benEdit], 'ben: change next step')
    assert.equal(benCommit.ok, true)

    const anaSlot = ana.store.readThread(original.record.id)
    assert.ok(anaSlot !== null && !anaSlot.quarantined)
    if (anaSlot === null || anaSlot.quarantined) return
    const anaEdit: RecordChange = {
      kind: 'thread',
      record: {
        ...anaSlot.record,
        spine: { ...anaSlot.record.spine, next_step: 'ana changed the next step' },
        updated_at: ana.rt.now()
      }
    }
    const anaCommit = ana.store.commit([anaEdit], 'ana: change next step')
    assert.equal(anaCommit.ok, true)

    const secondAnaSync = sync(ana.rt, ana.store, anaLayout)
    assert.equal(secondAnaSync.ok, true)
    if (!secondAnaSync.ok) return
    assert.equal(secondAnaSync.action, 'pushed')

    const remoteBeforeBenSync = git(ben.rt, remote, ['rev-parse', 'refs/logbook/ledger'])
    assert.equal(remoteBeforeBenSync.ok, true)

    const secondBenSync = sync(ben.rt, ben.store, benLayout)

    assert.equal(secondBenSync.ok, false)
    if (secondBenSync.ok) return
    assert.equal(secondBenSync.reason, 'conflict')
    const nextStepConflict = secondBenSync.conflicts.find((c) => c.field === 'spine.next_step')
    assert.ok(nextStepConflict !== undefined)
    assert.equal(nextStepConflict?.ours, 'ben changed the next step')
    assert.equal(nextStepConflict?.theirs, 'ana changed the next step')

    const benSlotAfter = ben.store.readThread(original.record.id)
    assert.ok(benSlotAfter !== null && !benSlotAfter.quarantined)
    if (benSlotAfter === null || benSlotAfter.quarantined) return
    assert.equal(benSlotAfter.record.spine.next_step, 'ben changed the next step')

    const anaSlotAfter = ana.store.readThread(original.record.id)
    assert.ok(anaSlotAfter !== null && !anaSlotAfter.quarantined)
    if (anaSlotAfter === null || anaSlotAfter.quarantined) return
    assert.equal(anaSlotAfter.record.spine.next_step, 'ana changed the next step')

    const remoteAfterBenSync = git(ben.rt, remote, ['rev-parse', 'refs/logbook/ledger'])
    assert.equal(remoteAfterBenSync.ok, true)
    if (!remoteBeforeBenSync.ok || !remoteAfterBenSync.ok) return
    assert.equal(remoteAfterBenSync.stdout.trim(), remoteBeforeBenSync.stdout.trim())

    const conflictsFile = readFileSync(path.join(benLayout.state, 'conflicts.json'), 'utf8')
    const storedConflicts = JSON.parse(conflictsFile) as unknown[]
    assert.equal(storedConflicts.length, secondBenSync.conflicts.length)
  })
})
