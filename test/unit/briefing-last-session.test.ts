import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { PARK_THREAD_ACTOR } from '../../src/domain/session-log.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const LEGACY_MARKER =
  '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead'

const threadWith = (lastSession: string): Thread => ({
  id: rt.ulid(),
  slug: 'last-session-fixture',
  title: 'Last Session Fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the derivation',
    next_step: 'write the tests',
    last_session: lastSession,
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const ids = Array.from({ length: 6 }, () => rt.ulid()).sort()

const entryAt = (index: number, threadId: string, actor: string, body: string): SessionEntry => {
  const id = ids[index]
  assert.ok(id !== undefined, `the fixture asked for id ${index} but only ${ids.length} were minted`)
  return { id, thread_id: threadId, actor, body, created_at: rt.now() }
}

const sectionOf = (rendered: string, heading: string): string[] => {
  const lines = rendered.split('\n')
  const start = lines.indexOf(heading)
  assert.notEqual(start, -1, `the briefing must carry the ${heading} heading`)
  const rest = lines.slice(start + 2)
  const end = rest.findIndex((line) => line.length === 0)
  return end === -1 ? rest : rest.slice(0, end)
}

test('briefing.last-session-renders-the-previous-sessions-entries-newest-first-with-their-ids', () => {
  const thread = threadWith('the hand-written summary nobody refreshed')
  const entries = [
    entryAt(0, thread.id, 'claude', 'older session, first entry'),
    entryAt(1, thread.id, PARK_THREAD_ACTOR, 'older session, parked'),
    entryAt(2, thread.id, 'claude', 'previous session, first entry'),
    entryAt(3, thread.id, PARK_THREAD_ACTOR, 'previous session, parked')
  ]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    `- ${ids[3]} previous session, parked`,
    `- ${ids[2]} previous session, first entry`
  ])
  assert.equal(
    rendered.includes('the hand-written summary nobody refreshed'),
    false,
    'the stored legacy text must not render while the previous session has entries of its own'
  )
  assert.equal(rendered.includes(LEGACY_MARKER), false, 'the legacy marker must not render on a derived section')
})

test('briefing.last-session-falls-back-to-the-stored-text-marked-as-legacy', () => {
  const thread = threadWith('the hand-written summary nobody refreshed')

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, [])

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    LEGACY_MARKER,
    'the hand-written summary nobody refreshed'
  ])
})

test('briefing.last-session-is-omitted-when-there-are-no-entries-and-no-stored-text', () => {
  const rendered = renderBriefing(threadWith(''), EMPTY_INTEGRITY, null, null, false, [])
  assert.equal(rendered.includes('**Last session:**'), false)
  assert.equal(rendered.includes(LEGACY_MARKER), false)
})

test('briefing.deriving-last-session-deletes-nothing-from-the-record', () => {
  const thread = threadWith('the hand-written summary nobody refreshed')
  const entries = [entryAt(0, thread.id, 'claude', 'previous session, only entry')]

  renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.equal(
    thread.spine.last_session,
    'the hand-written summary nobody refreshed',
    'rendering must leave the stored field exactly as it was'
  )
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the record must still be schema-admissible after a render')
})

test('briefing.a-session-entry-that-does-not-fit-the-budget-carries-the-clip-marker', () => {
  const thread = threadWith('')
  const entries = Array.from({ length: 40 }, (_, index) =>
    index < ids.length
      ? entryAt(index, thread.id, 'claude', 'x'.repeat(8000))
      : { id: `${rt.ulid()}`, thread_id: thread.id, actor: 'claude', body: 'x'.repeat(8000), created_at: rt.now() }
  )

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.equal(rendered.length <= 12000, true, 'the briefing must be searched down into its character budget')
  assert.equal(
    sectionOf(rendered, '**Last session:**').length,
    40,
    'every entry of the previous session must render, however tight the budget'
  )
  assert.equal(
    sectionOf(rendered, '**Last session:**').every((line) => line.endsWith(CLIP_MARKER)),
    true,
    'every shortened entry line must end with the shared clip marker'
  )
})

test('briefing.a-session-entry-that-fits-renders-whole-with-no-marker', () => {
  const thread = threadWith('')
  const entries = [entryAt(0, thread.id, 'claude', 'y'.repeat(1200))]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [`- ${ids[0]} ${'y'.repeat(1200)}`])
  assert.equal(rendered.includes(CLIP_MARKER), false, 'a briefing that fits its budget must carry no clip marker')
})

test('briefing.unreadable-session-entries-are-counted-and-addressed-in-last-session', () => {
  const thread = threadWith('')
  const entries = [entryAt(0, thread.id, 'claude', 'a readable entry')]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries, 2)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    `- ${ids[0]} a readable entry`,
    `- 2 session log entries on this thread could not be read; see logbook://sessions/${thread.id} for the complete record`
  ])
})

test('briefing.a-single-unreadable-session-entry-reads-singular', () => {
  const thread = threadWith('')
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, [], 1)
  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    `- 1 session log entry on this thread could not be read; see logbook://sessions/${thread.id} for the complete record`
  ])
})

test('briefing.last-session-heading-appears-when-only-entries-are-unreadable', () => {
  const thread = threadWith('')
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, [], 3)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    `- 3 session log entries on this thread could not be read; see logbook://sessions/${thread.id} for the complete record`
  ])
})
