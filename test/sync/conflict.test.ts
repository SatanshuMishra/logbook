import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { BindingRecord, type Binding } from '../../src/schema/binding.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readAllRecordFiles } from '../../src/store/read-path.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { sync } from '../../src/merge/sync.ts'
import { writeRecords, type RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import * as caps from '../../src/schema/caps.ts'
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
    assert.equal(mergeOutcome.reason, 'unparseable')
    if (mergeOutcome.reason !== 'unparseable') return
    assert.deepEqual(mergeOutcome.records, [badRelPath])

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

test('sync.a-merge-carries-a-remote-only-binding-record-through', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'binding-carry-thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const pushA = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushA.ok, true)

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)

    const bindingId = ben.rt.ulid()
    const bindingRelPath = `bindings/${bindingId}.json`
    const bindingContent = JSON.stringify({
      id: bindingId,
      thread_id: threadA.record.id,
      branch: 'feat/binding-carry-fixture',
      created_at: ben.rt.now()
    })
    const bindingWrite = writeRecords(
      ben.rt,
      benLayout,
      [{ kind: 'raw', relPath: bindingRelPath, content: bindingContent }],
      'ben: bind a branch to thread a'
    )
    assert.equal(bindingWrite.ok, true)

    const pushBinding = sync(ben.rt, ben.store, benLayout)
    assert.equal(pushBinding.ok, true)
    if (!pushBinding.ok) return
    assert.equal(pushBinding.action, 'pushed')

    const threadB = makeThread(ana.rt, 'binding-carry-thread-b')
    const createB = ana.store.commit([threadB], 'ana: create thread b')
    assert.equal(createB.ok, true)

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(mergeOutcome.ok, true, 'a merge must carry a well-formed remote-only binding record through')
    if (!mergeOutcome.ok) return
    assert.equal(mergeOutcome.action, 'merged')

    const materialisedPath = path.join(anaLayout.records, bindingRelPath)
    assert.equal(
      readFileSync(materialisedPath, 'utf8'),
      bindingContent,
      'the carried binding record must reach the materialised records with its bytes intact'
    )

    const pushedBindingContent = git(ana.rt, remote, ['cat-file', '-p', `${LEDGER_REF}:${bindingRelPath}`])
    assert.equal(pushedBindingContent.ok, true)
    if (!pushedBindingContent.ok) return
    assert.equal(
      pushedBindingContent.stdout,
      bindingContent,
      'the carried binding record must reach the pushed tree with its bytes intact'
    )

    const carriedSlots = readAllRecordFiles<Binding>(path.join(anaLayout.records, 'bindings'), BindingRecord)
    const carriedSlot = carriedSlots.find((slot) => !slot.quarantined && slot.record.id === bindingId)
    assert.ok(
      carriedSlot !== undefined && !carriedSlot.quarantined,
      'the carried binding record must have passed the binding schema the merge validates against'
    )
  })
})

test('sync.refuses-a-remote-binding-record-it-cannot-parse', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'malformed-binding-thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const pushA = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushA.ok, true)

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)

    const bindingId = ben.rt.ulid()
    const bindingRelPath = `bindings/${bindingId}.json`
    const malformedContent = '{"id":"not-a-ulid"}'
    const bindingWrite = writeRecords(
      ben.rt,
      benLayout,
      [{ kind: 'raw', relPath: bindingRelPath, content: malformedContent }],
      'ben: record a binding the schema will reject'
    )
    assert.equal(bindingWrite.ok, true)

    const pushBadBinding = sync(ben.rt, ben.store, benLayout)
    assert.equal(pushBadBinding.ok, true)
    if (!pushBadBinding.ok) return
    assert.equal(pushBadBinding.action, 'pushed')

    const threadB = makeThread(ana.rt, 'malformed-binding-thread-b')
    const createB = ana.store.commit([threadB], 'ana: create thread b')
    assert.equal(createB.ok, true)

    const anaRefBefore = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(anaRefBefore.ok, true)
    if (!anaRefBefore.ok) return

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(mergeOutcome.ok, false, 'a merge carrying a remote binding record the schema rejects must be refused')
    if (mergeOutcome.ok) return
    assert.equal(mergeOutcome.reason, 'unparseable')
    if (mergeOutcome.reason !== 'unparseable') return
    assert.deepEqual(mergeOutcome.records, [bindingRelPath])

    const anaRefAfter = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(anaRefAfter.ok, true)
    if (!anaRefAfter.ok) return
    assert.equal(anaRefAfter.stdout.trim(), anaRefBefore.stdout.trim(), 'the refused merge must not advance the local ledger ref')

    const refusedRecordInRef = git(ana.rt, ana.repo, ['cat-file', '-p', `${LEDGER_REF}:${bindingRelPath}`])
    assert.equal(refusedRecordInRef.ok, false, 'the malformed binding record must never reach the local ledger ref')

    const localListing = git(ana.rt, ana.repo, ['ls-tree', '-r', '--name-only', LEDGER_REF])
    assert.equal(localListing.ok, true)
    if (!localListing.ok) return
    assert.equal(
      localListing.stdout.includes(bindingRelPath),
      false,
      'the malformed binding record must be absent from every path in the local ledger ref'
    )

    const remoteRecordContent = git(ana.rt, remote, ['cat-file', '-p', `${LEDGER_REF}:${bindingRelPath}`])
    assert.equal(remoteRecordContent.ok, true, 'the refusal must leave the remote copy of the record intact')
    if (!remoteRecordContent.ok) return
    assert.equal(remoteRecordContent.stdout, malformedContent)
  })
})

test('sync.a-merge-that-would-overflow-a-stored-cap-refuses-and-writes-nothing', () => {
  withTwoClones((ana, ben, _remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const original = makeThread(ana.rt, 'union-overflow-thread')
    const created = ana.store.commit([original], 'ana: create thread for the union-overflow probe')
    assert.equal(created.ok, true)

    const firstAnaSync = sync(ana.rt, ana.store, anaLayout)
    assert.equal(firstAnaSync.ok, true)

    const firstBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(firstBenSync.ok, true)

    const benSlot = ben.store.readThread(original.record.id)
    assert.ok(benSlot !== null && !benSlot.quarantined)
    if (benSlot === null || benSlot.quarantined) return
    const benOutOfScope = Array.from({ length: caps.OUT_OF_SCOPE_MAX_ELEMENTS }, (_, i) => ({
      id: ben.rt.ulid(),
      text: `ben out-of-scope ${i}`
    }))
    const benEdit: RecordChange = {
      kind: 'thread',
      record: {
        ...benSlot.record,
        spine: { ...benSlot.record.spine, out_of_scope: benOutOfScope },
        updated_at: ben.rt.now()
      }
    }
    const benCommit = ben.store.commit([benEdit], 'ben: fill out-of-scope to the stored cap')
    assert.equal(benCommit.ok, true)

    const anaSlot = ana.store.readThread(original.record.id)
    assert.ok(anaSlot !== null && !anaSlot.quarantined)
    if (anaSlot === null || anaSlot.quarantined) return
    const anaOutOfScope = Array.from({ length: caps.OUT_OF_SCOPE_MAX_ELEMENTS }, (_, i) => ({
      id: ana.rt.ulid(),
      text: `ana out-of-scope ${i}`
    }))
    const anaEdit: RecordChange = {
      kind: 'thread',
      record: {
        ...anaSlot.record,
        spine: { ...anaSlot.record.spine, out_of_scope: anaOutOfScope },
        updated_at: ana.rt.now()
      }
    }
    const anaCommit = ana.store.commit([anaEdit], 'ana: fill out-of-scope to the stored cap with disjoint ids')
    assert.equal(anaCommit.ok, true)

    const secondAnaSync = sync(ana.rt, ana.store, anaLayout)
    assert.equal(secondAnaSync.ok, true)
    if (!secondAnaSync.ok) return
    assert.equal(secondAnaSync.action, 'pushed')

    const benRecordPath = path.join(benLayout.records, 'threads', `${original.record.id}.json`)
    const benRecordBefore = readFileSync(benRecordPath, 'utf8')

    const secondBenSync = sync(ben.rt, ben.store, benLayout)

    assert.equal(secondBenSync.ok, false, 'a merge whose union overflows a stored array cap must be refused')
    if (secondBenSync.ok) return
    assert.equal(secondBenSync.reason, 'rejected')
    if (secondBenSync.reason !== 'rejected') return
    assert.equal(secondBenSync.cause, 'invalid-merged-record')
    assert.equal(secondBenSync.field, 'spine.out_of_scope')

    const benRecordAfter = readFileSync(benRecordPath, 'utf8')
    assert.equal(benRecordAfter, benRecordBefore, 'a refused merge must leave the local record on disk untouched')
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

test('sync.a-failed-sync-leaves-a-pending-conflict-file-untouched', () => {
  withTwoClones((ana, ben, _remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const original = makeThread(ana.rt, 'shared-thread-3')
    const created = ana.store.commit([original], 'ana: create shared thread 3')
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
      record: { ...benSlot.record, spine: { ...benSlot.record.spine, next_step: 'ben moved it again' }, updated_at: ben.rt.now() }
    }
    assert.equal(ben.store.commit([benEdit], 'ben: change next step').ok, true)

    const anaSlot = ana.store.readThread(original.record.id)
    assert.ok(anaSlot !== null && !anaSlot.quarantined)
    if (anaSlot === null || anaSlot.quarantined) return
    const anaEdit: RecordChange = {
      kind: 'thread',
      record: { ...anaSlot.record, spine: { ...anaSlot.record.spine, next_step: 'ana moved it again' }, updated_at: ana.rt.now() }
    }
    assert.equal(ana.store.commit([anaEdit], 'ana: change next step').ok, true)

    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)

    const conflictingBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(conflictingBenSync.ok, false)
    if (conflictingBenSync.ok) return
    assert.equal(conflictingBenSync.reason, 'conflict')

    const conflictsPath = path.join(benLayout.state, 'conflicts.json')
    const conflictsBefore = readFileSync(conflictsPath, 'utf8')
    assert.ok(conflictsBefore.length > 0)

    ben.goOffline()

    const offlineBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(offlineBenSync.ok, false)
    if (offlineBenSync.ok) return
    assert.equal(offlineBenSync.reason, 'offline')

    const conflictsAfter = readFileSync(conflictsPath, 'utf8')
    assert.equal(conflictsAfter, conflictsBefore, 'a failed sync must leave the pending conflict file byte-identical')
  })
})

test('sync.a-locally-quarantined-record-is-logged-not-silently-dropped', () => {
  withTwoClones((ana, ben, _remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'local-quarantine-thread-a')
    assert.equal(ana.store.commit([threadA], 'ana: create thread a').ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const threadC = makeThread(ben.rt, 'local-quarantine-thread-c')
    assert.equal(ben.store.commit([threadC], 'ben: create thread c').ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const badRelPath = 'decisions/local-quarantine-not-a-valid-decision.json'
    const rawWrite = writeRecords(
      ana.rt,
      anaLayout,
      [{ kind: 'raw', relPath: badRelPath, content: '{"this is not a valid decision record":true}' }],
      'ana: record a decision the schema will reject'
    )
    assert.equal(rawWrite.ok, true)

    const events: Record<string, unknown>[] = []
    const watchRt: Runtime = { ...ana.rt, log: (record) => { events.push(record) } }

    const mergeOutcome = sync(watchRt, ana.store, anaLayout)
    assert.equal(mergeOutcome.ok, true, 'a locally-quarantined record must not block the merge')

    const quarantineLogs = events.filter((record) => record.event === 'sync.local-record-quarantined')
    assert.equal(quarantineLogs.length, 1, 'the locally-quarantined decision must be named to the operator exactly once')
    assert.equal(quarantineLogs[0]?.level, 'warn')
    assert.equal(quarantineLogs[0]?.kind, 'decision')
    assert.equal(typeof quarantineLogs[0]?.reason, 'string')
  })
})

test('sync.an-unparseable-ancestor-record-is-logged-not-silently-degraded', () => {
  withTwoClones((ana, ben, _remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'ancestor-thread-a')
    assert.equal(ana.store.commit([threadA], 'ana: create thread a').ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const badRelPath = 'decisions/ancestor-not-a-valid-decision.json'
    const badWrite = writeRecords(
      ana.rt,
      anaLayout,
      [{ kind: 'raw', relPath: badRelPath, content: '{"this is not a valid decision record":true}' }],
      'ana: record a decision the schema will reject'
    )
    assert.equal(badWrite.ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const validDecisionContent = JSON.stringify({
      id: ben.rt.ulid(),
      thread_id: threadA.record.id,
      title: 'a decision fixed on top of the ancestor',
      context: 'the ancestor carried a record this version could not parse',
      options: ['leave it broken', 'fix it'],
      outcome: 'fix it',
      commit: null,
      supersedes: [],
      created_at: ben.rt.now()
    })
    const fixWrite = writeRecords(
      ben.rt,
      benLayout,
      [{ kind: 'raw', relPath: badRelPath, content: validDecisionContent }],
      'ben: fix the previously unparseable decision'
    )
    assert.equal(fixWrite.ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const threadB = makeThread(ana.rt, 'ancestor-thread-b')
    assert.equal(ana.store.commit([threadB], 'ana: create thread b').ok, true)

    const events: Record<string, unknown>[] = []
    const watchRt: Runtime = { ...ana.rt, log: (record) => { events.push(record) } }

    const mergeOutcome = sync(watchRt, ana.store, anaLayout)
    assert.equal(mergeOutcome.ok, true, 'an unparseable ancestor record must not block the merge')

    const ancestorLogs = events.filter((record) => record.event === 'sync.ancestor-record-unparseable')
    assert.equal(ancestorLogs.length, 1, 'the unparseable ancestor record must be named to the operator exactly once')
    assert.equal(ancestorLogs[0]?.level, 'warn')
    assert.equal(ancestorLogs[0]?.count, 1)
    assert.deepEqual(ancestorLogs[0]?.records, [badRelPath])
  })
})

test('sync.a-scratch-cleanup-failure-does-not-replace-the-merge-outcome', () => {
  withTwoClones((ana, ben, _remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'cleanup-thread-a')
    assert.equal(ana.store.commit([threadA], 'ana: create thread a').ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const threadC = makeThread(ben.rt, 'cleanup-thread-c')
    assert.equal(ben.store.commit([threadC], 'ben: create thread c').ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const threadB = makeThread(ana.rt, 'cleanup-thread-b')
    assert.equal(ana.store.commit([threadB], 'ana: create thread b').ok, true)

    const removeScratch = (): void => {
      throw new Error('scratch cleanup exploded')
    }

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout, { removeScratch })

    assert.equal(mergeOutcome.ok, true, 'a cleanup failure must not replace the merge outcome')
    if (!mergeOutcome.ok) return
    assert.equal(mergeOutcome.action, 'merged')
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
