import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARK_THREAD_ACTOR, previousSessionEntries } from '../../src/domain/session-log.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const THREAD_ID = rt.ulid()

const ids = Array.from({ length: 8 }, () => rt.ulid()).sort()

const entryAt = (index: number, actor: string, body: string): SessionEntry => {
  const id = ids[index]
  assert.ok(id !== undefined, `the fixture asked for id ${index} but only ${ids.length} were minted`)
  return { id, thread_id: THREAD_ID, actor, body, created_at: rt.now() }
}

const bodies = (entries: readonly SessionEntry[]): string[] => entries.map((entry) => entry.body)

test('session-log.the-previous-session-is-the-run-of-entries-after-the-last-completed-park', () => {
  const entries = [
    entryAt(0, 'claude', 'one'),
    entryAt(1, 'claude', 'two'),
    entryAt(2, PARK_THREAD_ACTOR, 'parked the first session'),
    entryAt(3, 'claude', 'three'),
    entryAt(4, PARK_THREAD_ACTOR, 'parked the second session')
  ]

  assert.deepEqual(
    bodies(previousSessionEntries(entries)),
    ['parked the second session', 'three'],
    'the previous session is the entries after the first park entry, newest first'
  )
})

test('session-log.entries-written-after-the-last-park-are-the-previous-session', () => {
  const entries = [
    entryAt(0, 'claude', 'one'),
    entryAt(1, PARK_THREAD_ACTOR, 'parked the first session'),
    entryAt(2, 'claude', 'two'),
    entryAt(3, 'claude', 'three')
  ]

  assert.deepEqual(
    bodies(previousSessionEntries(entries)),
    ['three', 'two'],
    'a session that logged entries and never parked is still the previous session'
  )
})

test('session-log.a-log-with-no-park-entry-is-one-session', () => {
  const entries = [entryAt(0, 'claude', 'one'), entryAt(1, 'claude', 'two')]
  assert.deepEqual(bodies(previousSessionEntries(entries)), ['two', 'one'])
})

test('session-log.a-log-holding-only-a-park-entry-is-one-session', () => {
  const entries = [entryAt(0, PARK_THREAD_ACTOR, 'parked')]
  assert.deepEqual(bodies(previousSessionEntries(entries)), ['parked'])
})

test('session-log.an-empty-log-has-no-previous-session', () => {
  assert.deepEqual(previousSessionEntries([]), [])
})

test('session-log.the-segment-is-decided-by-entry-id-order-not-by-argument-order', () => {
  const ordered = [
    entryAt(0, 'claude', 'one'),
    entryAt(1, PARK_THREAD_ACTOR, 'parked the first session'),
    entryAt(2, 'claude', 'two'),
    entryAt(3, 'claude', 'three')
  ]
  const shuffled = [ordered[3], ordered[0], ordered[2], ordered[1]].flatMap((entry) => (entry === undefined ? [] : [entry]))

  assert.equal(shuffled.length, 4, 'the shuffled fixture must hold every entry')
  assert.deepEqual(bodies(previousSessionEntries(shuffled)), bodies(previousSessionEntries(ordered)))
})

test('session-log.the-park-actor-is-the-one-park_thread-writes', () => {
  assert.equal(PARK_THREAD_ACTOR, 'logbook:park_thread')
})
