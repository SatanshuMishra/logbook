import test from 'node:test'
import assert from 'node:assert/strict'
import { conflictRefusal, gitTooOldRefusal, rejectedRefusal } from '../../src/server/tools/sync_ledger.ts'
import type { RejectedOutcome } from '../../src/merge/sync.ts'
import type { ConflictReportEntry } from '../../src/merge/conflict.ts'

const NEWLINE = String.fromCodePoint(0x0a)
const BELL = String.fromCodePoint(0x07)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)
const CLOSING_ANGLE = String.fromCodePoint(0x3e)

const BASE_BLOB = '1111111111111111111111111111111111111111'
const LOCAL_BLOB = '2222222222222222222222222222222222222222'
const REMOTE_BLOB = '3333333333333333333333333333333333333333'

const threadConflict = (overrides: Partial<ConflictReportEntry> = {}): ConflictReportEntry => ({
  path: 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json',
  base_blob: BASE_BLOB,
  local_blob: LOCAL_BLOB,
  remote_blob: REMOTE_BLOB,
  local_changes: ['spine.active_goal', 'updated_at'],
  remote_changes: ['spine.next_step', 'updated_at'],
  ...overrides
})

test('sync-ledger-refusal.a-conflict-names-each-file-where-to-read-its-versions-and-what-each-side-changed', () => {
  const refusal = conflictRefusal([threadConflict()])

  assert.equal(refusal.field, 'sync')
  assert.equal(refusal.retryable, true)
  assert.ok(refusal.message.includes('<threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json>'), refusal.message)
  assert.ok(refusal.message.includes(`ancestor: logbook://conflict/${BASE_BLOB}`), refusal.message)
  assert.ok(refusal.message.includes(`local: logbook://conflict/${LOCAL_BLOB}`), refusal.message)
  assert.ok(refusal.message.includes(`remote: logbook://conflict/${REMOTE_BLOB}`), refusal.message)
  assert.ok(refusal.message.includes('changed locally: spine.active_goal, updated_at'), refusal.message)
  assert.ok(refusal.message.includes('changed remotely: spine.next_step, updated_at'), refusal.message)
})

test('sync-ledger-refusal.a-conflict-with-no-shared-history-says-so-and-names-what-differs-between-the-two', () => {
  const refusal = conflictRefusal([
    threadConflict({ base_blob: null, local_changes: ['spine.active_goal'], remote_changes: ['spine.active_goal'] })
  ])

  assert.ok(refusal.message.includes('ancestor: none'), refusal.message)
  assert.ok(refusal.message.includes('differs between the two: spine.active_goal'), refusal.message)
  assert.doesNotMatch(refusal.message, /changed locally|changed remotely/, refusal.message)
})

test('sync-ledger-refusal.a-conflicted-file-that-is-not-valid-json-says-its-changes-could-not-be-listed', () => {
  const refusal = conflictRefusal([threadConflict({ local_changes: null, remote_changes: null })])

  assert.ok(refusal.message.includes('changed locally: could not be listed, a version is not valid JSON'), refusal.message)
})

test('sync-ledger-refusal.a-conflict-directs-a-review-and-never-asks-for-a-side-to-be-picked', () => {
  const refusal = conflictRefusal([threadConflict()])

  assert.match(refusal.message, /review/i, refusal.message)
  assert.match(refusal.message, /user/i, refusal.message)
  assert.match(refusal.message, /resolve_conflict/, refusal.message)
  assert.doesNotMatch(`${refusal.accepted}\n${refusal.example}\n${refusal.message}`, /winner/i, refusal.message)
})

test('sync-ledger-refusal.escapes-a-hostile-conflicted-path', () => {
  const hostile = `threads/bad${NEWLINE}${BELL}${RIGHT_TO_LEFT_OVERRIDE}${CLOSING_ANGLE}name.json`
  const refusal = conflictRefusal([threadConflict({ path: hostile })])

  assert.ok(
    refusal.message.includes('<threads/badU+000AU+0007U+202EU+003Ename.json>'),
    `a remote-controlled path must be escaped before the operator reads it, but the message read: ${refusal.message}`
  )
  assert.equal(refusal.message.includes(BELL), false, 'a control character inside a path must not reach the rendered refusal')
  assert.equal(refusal.message.includes(RIGHT_TO_LEFT_OVERRIDE), false, 'a bidi override inside a path must not reach the rendered refusal')
  assert.equal(
    refusal.message.includes(`bad${NEWLINE}`),
    false,
    'a newline inside a path must not reach the rendered refusal, or the rest of the name reads as a line the server wrote'
  )
})

test('sync-ledger-refusal.a-git-too-old-to-merge-names-the-version-found-and-the-version-needed', () => {
  const refusal = gitTooOldRefusal('2.34.1')

  assert.equal(refusal.field, 'sync')
  assert.equal(refusal.retryable, false, 'repeating the call cannot upgrade git')
  assert.ok(refusal.message.includes('2.34.1'), refusal.message)
  assert.ok(refusal.message.includes('2.38.0'), refusal.message)
  assert.match(refusal.message, /nothing was merged and nothing was pushed/, refusal.message)
})

const rejectedOutcome = (cause: 'contention' | 'local', detail: string): RejectedOutcome => ({
  ok: false,
  reason: 'rejected',
  cause,
  detail
})

test('sync-ledger-refusal.a-ref-another-sync-keeps-moving-renders-contention-not-an-origin-rejection', () => {
  const refusal = rejectedRefusal(rejectedOutcome('contention', 'the ledger ref moved under every attempt'))

  assert.equal(
    refusal.retryable,
    true,
    'a ref another sync keeps moving can be synced once that writer stops, so contention must be retryable'
  )
  assert.match(
    refusal.accepted,
    /not being moved by another sync/,
    `contention must say it wanted a ref no other sync was moving, but accepted read: ${refusal.accepted}`
  )
  assert.equal(
    refusal.example,
    'retry the call',
    `contention must tell the operator to retry and nothing more, but example read: ${refusal.example}`
  )
  assert.match(
    refusal.message,
    /ledger ref kept moving/,
    `contention must name the moving ref as what stopped the sync, but the message read: ${refusal.message}`
  )
  assert.match(
    refusal.message,
    /nothing was pushed/,
    `contention must tell the operator the shared copy was left where it was, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /origin refused/,
    `contention must not report a rejection origin never made, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /could not be updated/,
    `contention must not be rendered as a failure of this machine's own write, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.a-local-write-failure-says-this-machine-could-not-update-and-nothing-reached-origin', () => {
  const refusal = rejectedRefusal(rejectedOutcome('local', 'writing the ledger ref failed with EACCES'))

  assert.equal(
    refusal.retryable,
    true,
    'a write this machine could not complete can be retried once whatever blocked it is cleared'
  )
  assert.match(
    refusal.accepted,
    /a local ledger write that this machine can complete/,
    `the refusal must say it wanted a local write it could finish, but accepted read: ${refusal.accepted}`
  )
  assert.equal(
    refusal.example,
    'retry the call once the condition named below is cleared',
    `the refusal must point the operator at the condition it reported before retrying, but example read: ${refusal.example}`
  )
  assert.match(
    refusal.message,
    /this machine's own ledger could not be updated/,
    `the refusal must place the failure on this machine's own ledger, but the message read: ${refusal.message}`
  )
  assert.match(
    refusal.message,
    /nothing was sent to origin/,
    `the refusal must tell the operator the shared copy never saw the write, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /origin refused/,
    `a failure on this machine must not be reported as a rejection origin never made, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /ledger ref kept moving/,
    `a write this machine could not complete must not be rendered as contention, but the message read: ${refusal.message}`
  )
})
