import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { PARK_THREAD_ACTOR } from '../../src/domain/session-log.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { toEscaped } from '../../src/render/escape.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const STORED_LINE_BREAK = toEscaped('\n')

const LEGACY_MARKER =
  '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead'

const olderEntriesShownAsHeadlinesLine = (count: number, threadId: string): string =>
  count === 1
    ? `- 1 older session log entry on this thread is shown as its first line only; see logbook://sessions/${threadId} for the complete record`
    : `- ${count} older session log entries on this thread are shown as their first line only; see logbook://sessions/${threadId} for the complete record`

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
    landed: '',
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
    `- ${ids[3]}`,
    '> previous session, parked',
    `- ${ids[2]} previous session, first entry`,
    olderEntriesShownAsHeadlinesLine(1, thread.id)
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
    '> the hand-written summary nobody refreshed'
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
  const entries = Array.from({ length: 20 }, (_, index) =>
    index < ids.length
      ? entryAt(index, thread.id, 'claude', 'x'.repeat(8000))
      : { id: `${rt.ulid()}`, thread_id: thread.id, actor: 'claude', body: 'x'.repeat(8000), created_at: rt.now() }
  )

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)
  const newestId = [...entries]
    .map((entry) => entry.id)
    .sort()
    .at(-1)
  assert.ok(newestId !== undefined, 'the fixture must carry at least one entry, or there is no newest entry to name')
  const section = sectionOf(rendered, '**Last session:**')

  const entryLines = section.slice(0, -1)
  const headlineDisclosure = section.at(-1)

  assert.equal(rendered.length <= 12000, true, 'the briefing must be searched down into its character budget')
  assert.equal(
    entryLines.length,
    21,
    'every entry of the previous session must render, however tight the budget: the newest as its id line plus its one-line block, and the other nineteen as one headline each'
  )
  assert.equal(
    headlineDisclosure,
    olderEntriesShownAsHeadlinesLine(19, thread.id),
    'the nineteen headline entries must be counted and addressed, so the reader learns a body sits behind each one and where to read it'
  )
  assert.equal(section[0], `- ${newestId}`, 'the newest entry opens the section with its id on a line of its own')
  for (const entry of entries) {
    assert.equal(
      rendered.includes(entry.id),
      true,
      `every entry of the previous session must render, however tight the budget; the id of entry ${entry.id} appears nowhere`
    )
  }
  assert.equal(
    entryLines.slice(1).every((line) => line.endsWith(CLIP_MARKER)),
    true,
    'every shortened entry line must end with the shared clip marker'
  )
})

test('briefing.a-session-entry-that-fits-renders-whole-with-no-marker', () => {
  const thread = threadWith('')
  const entries = [entryAt(0, thread.id, 'claude', 'y'.repeat(1200))]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [`- ${ids[0]}`, `> ${'y'.repeat(1200)}`])
  assert.equal(rendered.includes(CLIP_MARKER), false, 'a briefing that fits its budget must carry no clip marker')
})

test('briefing.unreadable-session-entries-are-counted-and-addressed-in-last-session', () => {
  const thread = threadWith('')
  const entries = [entryAt(0, thread.id, 'claude', 'a readable entry')]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries, 2)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    `- ${ids[0]}`,
    '> a readable entry',
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

const lineMentioning = (rendered: string, entryId: string): string => {
  const mentioning = rendered.split('\n').filter((line) => line.includes(entryId))
  const line = mentioning[0]
  assert.equal(
    mentioning.length,
    1,
    `an older session entry must occupy exactly one rendered line; entry ${entryId} is mentioned on ${mentioning.length} lines:\n${mentioning.join('\n')}`
  )
  if (line === undefined) throw new Error(`the briefing carries no line naming session entry ${entryId}`)
  return line
}

test('briefing.an-older-session-entry-whose-body-opens-with-a-blank-line-still-shows-its-content', () => {
  const thread = threadWith('')
  const openingLine = 'the older entry says this after opening with a blank line'
  const entries = [
    entryAt(0, thread.id, 'claude', ['', openingLine, 'a second line nobody sees'].join(STORED_LINE_BREAK)),
    entryAt(1, thread.id, 'claude', 'the newest entry')
  ]
  for (const entry of entries) {
    assert.equal(SessionRecord.parse(entry).ok, true, `session entry ${entry.id} must itself be schema-admissible`)
  }

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.equal(
    lineMentioning(rendered, ids[0] as string),
    `- ${ids[0]} ${openingLine}`,
    'an older session entry renders its first NON-EMPTY stored line, so a body that opens with a blank line still reaches the page instead of rendering as its id alone'
  )
})

test('briefing.an-older-session-entry-with-no-non-empty-line-renders-its-id-and-no-trailing-space', () => {
  const thread = threadWith('')
  const entries = [
    entryAt(0, thread.id, 'claude', ['', '', ''].join(STORED_LINE_BREAK)),
    entryAt(1, thread.id, 'claude', 'the newest entry')
  ]
  for (const entry of entries) {
    assert.equal(SessionRecord.parse(entry).ok, true, `session entry ${entry.id} must itself be schema-admissible`)
  }

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.equal(
    lineMentioning(rendered, ids[0] as string),
    `- ${ids[0]}`,
    'an older session entry whose body holds no non-empty line still names itself, and its line ends at the id rather than trailing a space that stands for nothing'
  )
})

test('briefing.older-session-entries-are-counted-and-addressed-as-headlines', () => {
  const thread = threadWith('')
  const entries = [
    entryAt(0, thread.id, 'claude', ['older one, first line', 'older one, second line'].join(STORED_LINE_BREAK)),
    entryAt(1, thread.id, 'claude', ['older two, first line', 'older two, second line'].join(STORED_LINE_BREAK)),
    entryAt(2, thread.id, 'claude', 'the newest entry')
  ]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.deepEqual(
    sectionOf(rendered, '**Last session:**'),
    [
      `- ${ids[2]}`,
      '> the newest entry',
      `- ${ids[1]} older two, first line`,
      `- ${ids[0]} older one, first line`,
      olderEntriesShownAsHeadlinesLine(2, thread.id)
    ],
    'an older entry renders as a headline, so the page must say how many entries are shown that way and give the address that resolves to their whole bodies'
  )
})

test('briefing.a-single-older-session-entry-reads-singular', () => {
  const thread = threadWith('')
  const entries = [
    entryAt(0, thread.id, 'claude', ['the only older entry', 'its hidden second line'].join(STORED_LINE_BREAK)),
    entryAt(1, thread.id, 'claude', 'the newest entry')
  ]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    `- ${ids[1]}`,
    '> the newest entry',
    `- ${ids[0]} the only older entry`,
    olderEntriesShownAsHeadlinesLine(1, thread.id)
  ])
})

test('briefing.a-newest-entry-alone-is-not-described-as-a-headline', () => {
  const thread = threadWith('')
  const entries = [entryAt(0, thread.id, 'claude', ['the only entry', 'its second line'].join(STORED_LINE_BREAK))]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.equal(
    rendered.includes('shown as its first line only'),
    false,
    'the newest entry renders whole, so with no older entry behind it the headline sentence would be false'
  )
  assert.equal(rendered.includes('logbook://sessions/'), false, 'nothing is left out here, so no address is owed')
})
