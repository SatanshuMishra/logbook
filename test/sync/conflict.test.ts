import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { BindingRecord, type Binding } from '../../src/schema/binding.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readAllRecordFiles } from '../../src/store/read-path.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { sync, type SyncOutcome } from '../../src/merge/sync.ts'
import type { ConflictState } from '../../src/merge/conflict.ts'
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

const ledgerCommit = (rt: Runtime, repo: string): string => {
  const result = git(rt, repo, ['rev-parse', LEDGER_REF])
  assert.equal(result.ok, true, `expected ${LEDGER_REF} to resolve in ${repo}`)
  return result.ok ? result.stdout.trim() : ''
}

const blobText = (rt: Runtime, repo: string, blob: string | null): string => {
  assert.ok(blob !== null, 'expected a blob id, not an absent side')
  const result = git(rt, repo, ['cat-file', '-p', blob])
  assert.equal(result.ok, true, `expected blob ${blob} to be readable`)
  return result.ok ? result.stdout : ''
}

const conflictStateOf = (outcome: SyncOutcome): ConflictState => {
  assert.equal(outcome.ok, false, `expected a conflict, got ${JSON.stringify(outcome)}`)
  if (outcome.ok || outcome.reason !== 'conflict') throw new Error(`expected a conflict outcome, got ${JSON.stringify(outcome)}`)
  return outcome.state
}

const editNextStep = (teammate: Teammate, threadId: string, nextStep: string): RecordChange => {
  const slot = teammate.store.readThread(threadId)
  if (slot === null || slot.quarantined) throw new Error(`expected ${teammate.name} to read thread ${threadId}`)
  return {
    kind: 'thread',
    record: { ...slot.record, spine: { ...slot.record.spine, next_step: nextStep }, updated_at: teammate.rt.now() }
  }
}

const divergeOnNextStep = (ana: Teammate, ben: Teammate, slug: string): string => {
  const anaLayout = layoutIn(ana)
  const benLayout = layoutIn(ben)
  const original = makeThread(ana.rt, slug)
  assert.equal(ana.store.commit([original], `ana: create ${slug}`).ok, true)
  assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
  assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)
  assert.equal(ben.store.commit([editNextStep(ben, original.record.id, 'ben changed the next step')], 'ben: change next step').ok, true)
  assert.equal(ana.store.commit([editNextStep(ana, original.record.id, 'ana changed the next step')], 'ana: change next step').ok, true)
  const anaPush = sync(ana.rt, ana.store, anaLayout)
  assert.equal(anaPush.ok, true)
  return original.record.id
}

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
    const benLayout = layoutIn(ben)
    const threadId = divergeOnNextStep(ana, ben, 'shared-thread')
    const threadPath = `threads/${threadId}.json`

    const remoteBefore = ledgerCommit(ben.rt, remote)
    const localBefore = ledgerCommit(ben.rt, ben.repo)

    const state = conflictStateOf(sync(ben.rt, ben.store, benLayout))

    assert.deepEqual(state.paths.map((entry) => entry.path), [threadPath], 'git merges whole files, so the thread both changed is the conflict')
    const [entry] = state.paths
    if (entry === undefined) return
    assert.equal(JSON.parse(blobText(ben.rt, ben.repo, entry.base_blob)).spine.next_step, 'original next step')
    assert.equal(JSON.parse(blobText(ben.rt, ben.repo, entry.local_blob)).spine.next_step, 'ben changed the next step')
    assert.equal(JSON.parse(blobText(ben.rt, ben.repo, entry.remote_blob)).spine.next_step, 'ana changed the next step')
    assert.equal(state.local_commit, localBefore)
    assert.equal(state.remote_commit, remoteBefore)

    const benSlotAfter = ben.store.readThread(threadId)
    assert.ok(benSlotAfter !== null && !benSlotAfter.quarantined)
    if (benSlotAfter === null || benSlotAfter.quarantined) return
    assert.equal(benSlotAfter.record.spine.next_step, 'ben changed the next step')
    assert.equal(ledgerCommit(ben.rt, ben.repo), localBefore, 'a conflict must write nothing locally')
    assert.equal(ledgerCommit(ben.rt, remote), remoteBefore, 'a conflict must push nothing')

    assert.deepEqual(JSON.parse(readFileSync(path.join(benLayout.state, 'conflicts.json'), 'utf8')), state)
  })
})

test('sync.a-project-merge-setting-cannot-merge-a-conflicted-record-silently', () => {
  withTwoClones((ana, ben, _remote) => {
    const benLayout = layoutIn(ben)
    const threadId = divergeOnNextStep(ana, ben, 'union-attribute-thread')

    const infoDir = path.join(ben.repo, '.git', 'info')
    mkdirSync(infoDir, { recursive: true })
    writeFileSync(path.join(infoDir, 'attributes'), '*.json merge=union\n')

    const localBefore = ledgerCommit(ben.rt, ben.repo)
    const outcome = sync(ben.rt, ben.store, benLayout)

    assert.equal(
      outcome.ok,
      false,
      `a merge=union attribute makes git merge both one-line records into one file, which must be reported for review rather than stored: ${JSON.stringify(outcome)}`
    )
    const state = conflictStateOf(outcome)
    assert.deepEqual(state.paths.map((entry) => entry.path), [`threads/${threadId}.json`])
    assert.equal(ledgerCommit(ben.rt, ben.repo), localBefore, 'nothing a project setting merged may reach the ledger')
  })
})

test('sync.merges-a-remote-record-this-version-cannot-parse', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    assert.equal(ana.store.commit([makeThread(ana.rt, 'thread-a')], 'ana: create thread a').ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const badRelPath = 'decisions/not-a-valid-decision-record.json'
    const malformedContent = '{"this is not a valid decision record":true}'
    assert.equal(
      writeRecords(ben.rt, benLayout, [{ kind: 'raw', relPath: badRelPath, content: malformedContent }], 'ben: record a decision the schema will reject').ok,
      true
    )
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const threadB = makeThread(ana.rt, 'thread-b')
    assert.equal(ana.store.commit([threadB], 'ana: create thread b').ok, true)

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(mergeOutcome.ok, true, `git merges bytes, so a record this version cannot parse must not stop the merge: ${JSON.stringify(mergeOutcome)}`)
    if (!mergeOutcome.ok) return
    assert.equal(mergeOutcome.action, 'merged')
    const merged = git(ana.rt, ana.repo, ['cat-file', '-p', `${LEDGER_REF}:${badRelPath}`])
    assert.ok(merged.ok && merged.stdout === malformedContent, 'the record must be kept byte for byte in the merged ledger')
    const pushed = git(ana.rt, remote, ['cat-file', '-p', `${LEDGER_REF}:threads/${threadB.record.id}.json`])
    assert.equal(pushed.ok, true, "ana's own new thread must reach the shared copy")
    const readBack = ana.store.readThread(threadB.record.id)
    assert.ok(readBack !== null && !readBack.quarantined, "the unparseable record must not stop ana's other records being read")
  })
})

test('sync.merges-over-a-record-this-clone-cannot-parse-and-keeps-its-bytes', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'local-bad-thread-a')
    assert.equal(ana.store.commit([threadA], 'ana: create thread a').ok, true)
    const decisionId = ana.rt.ulid()
    const badRelPath = `decisions/${decisionId}.json`
    const validDecision = JSON.stringify({
      id: decisionId,
      thread_id: threadA.record.id,
      title: 'a decision both clones hold',
      context: 'shared before either clone changed it',
      options: ['one', 'two'],
      outcome: 'one',
      commit: null,
      supersedes: [],
      created_at: ana.rt.now()
    })
    assert.equal(writeRecords(ana.rt, anaLayout, [{ kind: 'raw', relPath: badRelPath, content: validDecision }], 'ana: record a decision').ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    assert.equal(ben.store.commit([makeThread(ben.rt, 'local-bad-thread-c')], 'ben: create thread c').ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const malformedContent = '{"this is not a valid decision record":true}'
    assert.equal(
      writeRecords(ana.rt, anaLayout, [{ kind: 'raw', relPath: badRelPath, content: malformedContent }], 'ana: overwrite the shared decision with bytes the schema rejects').ok,
      true
    )

    const mergeOutcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(mergeOutcome.ok, true, `a record this clone cannot parse must not stop the merge: ${JSON.stringify(mergeOutcome)}`)
    const pushed = git(ana.rt, remote, ['cat-file', '-p', `${LEDGER_REF}:${badRelPath}`])
    assert.ok(pushed.ok && pushed.stdout === malformedContent, "the record ana holds must reach the shared copy byte for byte, not be dropped by the merge")
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
    assert.ok(carriedSlot !== undefined && !carriedSlot.quarantined, 'the carried binding record must read back as a binding')
  })
})

const withGitReportingVersion = <T>(version: string, fn: (withOldGit: (rt: Runtime) => Runtime) => T): T => {
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  assert.ok(realGit.length > 0, 'expected a git on PATH to stand behind the version shim')
  const shimDir = mkdtempSync(path.join(tmpdir(), 'logbook-old-git-'))
  const shim = path.join(shimDir, 'git')
  writeFileSync(shim, `#!/bin/sh\nif [ "$3" = "version" ]; then echo "git version ${version}"; exit 0; fi\nexec "${realGit}" "$@"\n`)
  chmodSync(shim, 0o755)
  try {
    return fn((rt) => ({ ...rt, env: { ...rt.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}` } }))
  } finally {
    rmSync(shimDir, { recursive: true, force: true })
  }
}

test('sync.below-git-2-38-only-a-merge-is-refused', () => {
  withTwoClones((ana, ben, _remote) => {
    withGitReportingVersion('2.34.1', (withOldGit) => {
      const anaLayout = layoutIn(ana)
      const benLayout = layoutIn(ben)
      const anaOnOldGit = withOldGit(ana.rt)
      const benOnOldGit = withOldGit(ben.rt)

      assert.equal(ana.store.commit([makeThread(ana.rt, 'old-git-thread-a')], 'ana: create thread a').ok, true)
      const push = sync(anaOnOldGit, ana.store, anaLayout)
      assert.equal(push.ok, true, `a push needs no merge-tree and must work on an old git: ${JSON.stringify(push)}`)
      const fastForward = sync(benOnOldGit, ben.store, benLayout)
      assert.equal(fastForward.ok, true, `a fast-forward needs no merge-tree and must work on an old git: ${JSON.stringify(fastForward)}`)

      assert.equal(ben.store.commit([makeThread(ben.rt, 'old-git-thread-c')], 'ben: create thread c').ok, true)
      assert.equal(sync(benOnOldGit, ben.store, benLayout).ok, true)
      assert.equal(ana.store.commit([makeThread(ana.rt, 'old-git-thread-b')], 'ana: create thread b').ok, true)

      const localBefore = ledgerCommit(ana.rt, ana.repo)
      const refused = sync(anaOnOldGit, ana.store, anaLayout)
      assert.equal(refused.ok, false)
      if (refused.ok) return
      assert.equal(refused.reason, 'git-too-old', JSON.stringify(refused))
      if (refused.reason !== 'git-too-old') return
      assert.equal(refused.found, '2.34.1')
      assert.equal(ledgerCommit(ana.rt, ana.repo), localBefore, 'a refused merge must write nothing')

      const merged = sync(ana.rt, ana.store, anaLayout)
      assert.equal(merged.ok, true, `only the git version stopped the merge, so the real git must merge: ${JSON.stringify(merged)}`)
    })
  })
})

test('sync.clears-a-stale-conflict-file-on-the-next-clean-sync', () => {
  withTwoClones((ana, ben, _remote) => {
    const benLayout = layoutIn(ben)
    const threadId = divergeOnNextStep(ana, ben, 'shared-thread-2')

    const state = conflictStateOf(sync(ben.rt, ben.store, benLayout))
    const conflictsPath = path.join(benLayout.state, 'conflicts.json')
    assert.equal(state.paths.length > 0, true)
    assert.equal(existsSync(conflictsPath), true)

    const anasRecord = git(ben.rt, ben.repo, ['cat-file', '-p', `${state.remote_commit}:threads/${threadId}.json`])
    assert.equal(anasRecord.ok, true)
    if (!anasRecord.ok) return
    assert.equal(
      writeRecords(ben.rt, benLayout, [{ kind: 'raw', relPath: `threads/${threadId}.json`, content: anasRecord.stdout }], "ben: take ana's record whole").ok,
      true
    )

    const cleanBenSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(cleanBenSync.ok, true, JSON.stringify(cleanBenSync))

    assert.equal(existsSync(conflictsPath), false)
  })
})

test('sync.a-failed-sync-leaves-a-pending-conflict-file-untouched', () => {
  withTwoClones((ana, ben, _remote) => {
    const benLayout = layoutIn(ben)
    divergeOnNextStep(ana, ben, 'shared-thread-3')

    conflictStateOf(sync(ben.rt, ben.store, benLayout))

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
