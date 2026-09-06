import assert from 'node:assert/strict'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { sync } from '../../src/merge/sync.ts'
import { rejectedRefusal } from '../../src/server/tools/sync_ledger.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Teammate } from '../support/clone-fixture.ts'
import { withTwoClones } from '../support/clone-fixture.ts'

const STAMP_FILE_NAME = 'last-materialised'

type SyncReceiptFields = { local_sha: string | null; remote_sha: string | null }

const receiptOf = (outcome: object): Partial<SyncReceiptFields> => outcome as Partial<SyncReceiptFields>

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

const installRemoteHook = (remote: string, name: string, body: string): void => {
  const hookPath = join(remote, 'hooks', name)
  writeFileSync(hookPath, body, 'utf8')
  chmodSync(hookPath, 0o755)
}

const denyEveryPush = (remote: string): void => {
  installRemoteHook(remote, 'pre-receive', '#!/bin/sh\nexit 1\n')
}

const acceptThenDropEveryPush = (remote: string): void => {
  installRemoteHook(remote, 'post-receive', `#!/bin/sh\ngit update-ref -d ${LEDGER_REF}\n`)
}

const refIn = (rt: Runtime, repo: string): string => {
  const result = git(rt, repo, ['rev-parse', LEDGER_REF])
  assert.equal(result.ok, true, `expected ${LEDGER_REF} to resolve in the repository under test`)
  if (!result.ok) throw new Error('expected the ledger ref to resolve')
  return result.stdout.trim()
}

const seedAndCommit = (teammate: Teammate, slug: string): void => {
  const change = makeThread(teammate.rt, slug)
  const committed = teammate.store.commit([change], `${teammate.name}: create ${slug}`)
  assert.equal(committed.ok, true, `expected ${teammate.name} to commit ${slug}`)
}

test('sync.receipt-names-both-shas-after-a-push', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)
    seedAndCommit(ana, 'receipt-thread')

    const pushed = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushed.ok, true)
    if (!pushed.ok) return
    assert.equal(pushed.action, 'pushed')

    assert.equal(typeof receiptOf(pushed).local_sha, 'string', 'a confirmed push must report the local commit it pushed')
    assert.equal(typeof receiptOf(pushed).remote_sha, 'string', 'a confirmed push must report the commit read back from the remote')
    assert.equal(receiptOf(pushed).local_sha, receiptOf(pushed).remote_sha, 'the receipt is the two shas agreeing')

    assert.equal(
      receiptOf(pushed).remote_sha,
      refIn(ana.rt, remote),
      'the reported remote sha must be the commit the shared copy actually holds after the push'
    )
    assert.equal(
      receiptOf(pushed).local_sha,
      refIn(ana.rt, ana.repo),
      'the reported local sha must be the commit this machine actually holds'
    )
  })
})

test('sync.a-rejected-push-does-not-claim-pushed', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)

    seedAndCommit(ana, 'accepted-thread')
    const accepted = sync(ana.rt, ana.store, anaLayout)
    assert.equal(accepted.ok, true)
    if (!accepted.ok) return
    assert.equal(accepted.action, 'pushed')
    const remoteBeforeRejection = refIn(ana.rt, remote)
    assert.equal(receiptOf(accepted).remote_sha, remoteBeforeRejection)

    denyEveryPush(remote)

    seedAndCommit(ana, 'rejected-thread')
    const rejected = sync(ana.rt, ana.store, anaLayout)

    assert.equal(rejected.ok, false, 'a push the shared copy refuses must not be reported as a success')
    if (rejected.ok) return
    assert.equal(rejected.reason, 'rejected')
    assert.equal(rejected.cause, 'remote-rejected', 'origin refusing the push is a remote-rejected cause, not a generic one')

    const localAfter = refIn(ana.rt, ana.repo)
    const remoteAfter = refIn(ana.rt, remote)
    assert.notEqual(localAfter, remoteAfter, 'the fixture requires the two sides to have genuinely diverged')
    assert.equal(remoteAfter, remoteBeforeRejection, 'a rejected push must leave the shared copy where it was')

    const refusal = rejectedRefusal(rejected)
    assert.equal(refusal.retryable, false, 'repeating an identical call cannot make origin accept a push it refused')
    assert.doesNotMatch(
      refusal.message,
      /retry the call/i,
      'an origin refusal must not tell the operator to retry, since retrying cannot help'
    )
  })
})

test('sync.the-materialisation-stamp-is-not-a-push-receipt', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)

    seedAndCommit(ana, 'stamp-accepted-thread')
    const accepted = sync(ana.rt, ana.store, anaLayout)
    assert.equal(accepted.ok, true)

    denyEveryPush(remote)

    seedAndCommit(ana, 'stamp-rejected-thread')
    const rejected = sync(ana.rt, ana.store, anaLayout)
    assert.equal(rejected.ok, false)

    const stamp = readFileSync(join(anaLayout.state, STAMP_FILE_NAME), 'utf8').trim()
    const localAfter = refIn(ana.rt, ana.repo)
    const remoteAfter = refIn(ana.rt, remote)

    assert.equal(stamp, localAfter, 'the stamp records the local materialisation and follows the local ledger ref')
    assert.notEqual(stamp, remoteAfter, 'the stamp is not evidence about the shared copy')
    assert.notEqual(localAfter, remoteAfter, 'the fixture requires the two sides to have genuinely diverged')
  })
})

test('sync.an-unconfirmable-push-does-not-claim-pushed', () => {
  withTwoClones((ana, _ben, remote) => {
    const anaLayout = layoutIn(ana)
    acceptThenDropEveryPush(remote)

    seedAndCommit(ana, 'unconfirmable-thread')
    const outcome = sync(ana.rt, ana.store, anaLayout)

    assert.equal(outcome.ok, true, 'a push git accepted is still a success')
    if (!outcome.ok) return
    assert.equal(
      outcome.action,
      'pushed-unverified',
      'a push whose arrival cannot be read back must not claim to have been confirmed'
    )
    assert.equal(receiptOf(outcome).local_sha, null, 'an unconfirmable push reports no local sha')
    assert.equal(receiptOf(outcome).remote_sha, null, 'an unconfirmable push reports no remote sha')
  })
})

test('sync.a-ledger-ref-that-keeps-moving-is-a-contention-refusal-not-a-remote-rejection', () => {
  withTwoClones((ana, ben, _remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    seedAndCommit(ana, 'contention-thread-a')
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    seedAndCommit(ben, 'contention-thread-c')
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    seedAndCommit(ana, 'contention-thread-b')

    let racerCount = 0
    const raceOriginForward = (): void => {
      racerCount += 1
      seedAndCommit(ben, `contention-racer-${racerCount}`)
      const racerPush = sync(ben.rt, ben.store, benLayout)
      assert.equal(racerPush.ok, true, `expected the racer push #${racerCount} to land on origin`)
    }

    const result = sync(ana.rt, ana.store, anaLayout, { beforeCas: raceOriginForward })

    assert.equal(result.ok, false, 'a ledger ref that never stops moving cannot be synced')
    if (result.ok) return
    assert.equal(result.reason, 'rejected')
    assert.equal(racerCount >= 5, true, 'the racer must have moved origin on every attempt sync made')
    assert.equal(
      result.cause,
      'contention',
      'attempts running out while the ref keeps moving is contention, not an origin rejection'
    )
  })
})
