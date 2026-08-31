import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { sync } from '../../src/merge/sync.ts'
import { writeRecords, type RecordChange } from '../../src/store/write-path.ts'
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

test('sync.refuses-a-remote-record-it-cannot-parse', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const pushA = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushA.ok, true)

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)

    const badDecisionId = 'not-a-valid-decision-record'
    const badRelPath = `decisions/${badDecisionId}.json`
    const malformedContent = '{"this is not a valid decision record":true}'
    const rawWrite = writeRecords(
      ben.rt,
      benLayout,
      [{ kind: 'raw', relPath: badRelPath, content: malformedContent }],
      'ben: record a decision the schema will reject'
    )
    assert.equal(rawWrite.ok, true)

    const pushBadDecision = sync(ben.rt, ben.store, benLayout)
    assert.equal(pushBadDecision.ok, true)
    if (!pushBadDecision.ok) return
    assert.equal(pushBadDecision.action, 'pushed')

    const threadB = makeThread(ana.rt, 'thread-b')
    const createB = ana.store.commit([threadB], 'ana: create thread b')
    assert.equal(createB.ok, true)

    const anaRefBefore = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(anaRefBefore.ok, true)
    if (!anaRefBefore.ok) return

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(mergeOutcome.ok, false, 'a merge carrying remote bytes this version cannot parse must be refused')
    if (mergeOutcome.ok) return
    assert.equal(mergeOutcome.reason, 'rejected')
    assert.match(mergeOutcome.detail, new RegExp(badRelPath))

    const anaRefAfter = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(anaRefAfter.ok, true)
    if (!anaRefAfter.ok) return
    assert.equal(anaRefAfter.stdout.trim(), anaRefBefore.stdout.trim(), 'the refused merge must not advance the local ledger ref')

    const remoteRecordContent = git(ana.rt, remote, ['cat-file', '-p', `${LEDGER_REF}:${badRelPath}`])
    assert.equal(remoteRecordContent.ok, true, 'the refusal must leave the remote copy of the record intact')
    if (!remoteRecordContent.ok) return
    assert.equal(remoteRecordContent.stdout, malformedContent)
  })
})

test('sync.clears-a-stale-conflict-file-on-the-next-clean-sync', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const original = makeThread(ana.rt, 'shared-thread-2')
    const created = ana.store.commit([original], 'ana: create shared thread 2')
    assert.equal(created.ok, true)

    const firstAnaSync = sync(ana.rt, ana.store, anaLayout)
    assert.equal(firstAnaSync.ok, true)

    const firstBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(firstBenSync.ok, true)

    const benSlot = ben.store.readThread(original.record.id)
    assert.ok(benSlot !== null && !benSlot.quarantined)
    if (benSlot === null || benSlot.quarantined) return
    const benEdit: RecordChange = {
      kind: 'thread',
      record: { ...benSlot.record, spine: { ...benSlot.record.spine, next_step: 'ben moved it' }, updated_at: ben.rt.now() }
    }
    assert.equal(ben.store.commit([benEdit], 'ben: change next step').ok, true)

    const anaSlot = ana.store.readThread(original.record.id)
    assert.ok(anaSlot !== null && !anaSlot.quarantined)
    if (anaSlot === null || anaSlot.quarantined) return
    const anaEdit: RecordChange = {
      kind: 'thread',
      record: { ...anaSlot.record, spine: { ...anaSlot.record.spine, next_step: 'ana moved it' }, updated_at: ana.rt.now() }
    }
    assert.equal(ana.store.commit([anaEdit], 'ana: change next step').ok, true)

    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)

    const conflictingBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(conflictingBenSync.ok, false)
    if (conflictingBenSync.ok) return
    assert.equal(conflictingBenSync.reason, 'conflict')

    const conflictsPath = path.join(benLayout.state, 'conflicts.json')
    assert.equal((JSON.parse(readFileSync(conflictsPath, 'utf8')) as unknown[]).length > 0, true)

    const benCurrentSlot = ben.store.readThread(original.record.id)
    assert.ok(benCurrentSlot !== null && !benCurrentSlot.quarantined)
    if (benCurrentSlot === null || benCurrentSlot.quarantined) return
    const resolvedBenEdit: RecordChange = {
      kind: 'thread',
      record: {
        ...benCurrentSlot.record,
        spine: { ...benCurrentSlot.record.spine, next_step: 'ana moved it' },
        updated_at: ben.rt.now()
      }
    }
    assert.equal(ben.store.commit([resolvedBenEdit], "ben: resolve by adopting ana's next step").ok, true)

    const cleanBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(cleanBenSync.ok, true)

    assert.equal(existsSync(conflictsPath), false)
  })
})

test('sync.does-not-swallow-a-non-enoent-sessions-directory-error', () => {
  withTwoClones((ana, ben, _remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'thread-a')
    assert.equal(ana.store.commit([threadA], 'ana: create thread a').ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const threadC = makeThread(ben.rt, 'thread-c')
    assert.equal(ben.store.commit([threadC], 'ben: create thread c').ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const threadB = makeThread(ana.rt, 'thread-b')
    assert.equal(ana.store.commit([threadB], 'ana: create thread b').ok, true)

    const sessionsPath = path.join(anaLayout.records, 'sessions')
    rmSync(sessionsPath, { recursive: true, force: true })
    writeFileSync(sessionsPath, 'not a directory')

    try {
      assert.throws(() => sync(ana.rt, ana.store, anaLayout))
    } finally {
      rmSync(sessionsPath, { force: true })
    }
  })
})
