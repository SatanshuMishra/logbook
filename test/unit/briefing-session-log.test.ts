import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefingWithPasses, BRIEFING_MAX_CHARS, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { escapeStored, escapeStoredBlock, toEscaped } from '../../src/render/escape.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { SESSION_BODY_MAX } from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const STORED_LINE_BREAK = toEscaped('\n')
const LAST_SESSION_HEADING = '**Last session:**'
const NOT_SHOWN_HEADING = '**Not shown:**'
const BLOCK_LINE_PREFIX = '> '
const HEADING_PREFIX = '**'
const SESSION_ACTOR = 'claude'
const OVERSIZE_FILL_CHAR = 'x'

const storedLines = (body: string): string[] => body.split(STORED_LINE_BREAK)

const firstStoredLine = (body: string): string => storedLines(body)[0] ?? ''

const lastStoredLine = (body: string): string => storedLines(body).at(-1) ?? ''

const regionAfter = (page: string, heading: string): string[] => {
  const lines = page.split('\n')
  const headingAt = lines.indexOf(heading)
  if (headingAt === -1) return []
  const rest = lines.slice(headingAt + 1)
  const nextHeadingAt = rest.findIndex((line) => line.startsWith(HEADING_PREFIX))
  return nextHeadingAt === -1 ? rest : rest.slice(0, nextHeadingAt)
}

const openingLineFor = (tag: string): string => `opening line recorded by entry ${tag}`
const secondLineSentinelFor = (tag: string): string => `second-line-sentinel-${tag}-zqx`
const thirdLineSentinelFor = (tag: string): string => `third-line-sentinel-${tag}-zqx`

const multiLineBodyFor = (tag: string): string =>
  [openingLineFor(tag), secondLineSentinelFor(tag), thirdLineSentinelFor(tag)].join(STORED_LINE_BREAK)

const twoLineBodyFor = (tag: string): string => [openingLineFor(tag), secondLineSentinelFor(tag)].join(STORED_LINE_BREAK)

const anchorCriterion = (): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'the briefing renders the previous session log the way this thread settled it',
  done: false,
  kind: 'planned',
  check: 'node --test test/unit/briefing-session-log.test.ts exits 0',
  struck_by: null,
  settledness: 'proposed'
})

const shortThread = (): Thread => ({
  id: rt.ulid(),
  slug: 'session-log-briefing',
  title: 'the briefing renders the previous session log',
  status: 'open',
  blocked_by: null,
  completion_criteria: [anchorCriterion()],
  spine: {
    active_goal: 'render the previous session log so the newest entry survives whole',
    next_step: 'read the last session section of the briefing',
    landed: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

type SessionFixture = { thread: Thread; entries: SessionEntry[]; newest: SessionEntry; older: SessionEntry[] }

const entryOn = (thread: Thread, body: string): SessionEntry => ({
  id: rt.ulid(),
  thread_id: thread.id,
  actor: SESSION_ACTOR,
  body,
  created_at: rt.now()
})

const splitNewest = (thread: Thread, entries: readonly SessionEntry[]): SessionFixture => {
  const newest = entries.at(-1)
  if (newest === undefined) {
    throw new Error('a session log fixture must carry at least one entry, or there is no newest entry to measure')
  }
  return { thread, entries: [...entries], newest, older: entries.slice(0, entries.length - 1) }
}

const MULTI_LINE_ENTRY_TAGS = ['a', 'b', 'c', 'd', 'e'] as const

const buildMultiLineFixture = (): SessionFixture => {
  const thread = shortThread()
  return splitNewest(
    thread,
    MULTI_LINE_ENTRY_TAGS.map((tag) => entryOn(thread, multiLineBodyFor(tag)))
  )
}

const OVERSIZE_OLDER_TAGS = ['p', 'q', 'r'] as const
const OVERSIZE_NEWEST_TAG = 's'

const oversizeNewestBody = (): string => {
  const head = [openingLineFor(OVERSIZE_NEWEST_TAG), secondLineSentinelFor(OVERSIZE_NEWEST_TAG)].join(STORED_LINE_BREAK)
  const tailLength = SESSION_BODY_MAX - head.length - STORED_LINE_BREAK.length
  return [head, OVERSIZE_FILL_CHAR.repeat(tailLength)].join(STORED_LINE_BREAK)
}

const buildOversizeNewestFixture = (): SessionFixture => {
  const thread = shortThread()
  return splitNewest(thread, [
    ...OVERSIZE_OLDER_TAGS.map((tag) => entryOn(thread, twoLineBodyFor(tag))),
    entryOn(thread, oversizeNewestBody())
  ])
}

const assertFixtureAdmissible = (fixture: SessionFixture): void => {
  assert.equal(
    ThreadRecord.parse(fixture.thread).ok,
    true,
    'the session log fixture thread must itself be schema-admissible, or the renderer would never be handed it and nothing measured below would describe a reachable briefing'
  )
  for (const entry of fixture.entries) {
    assert.equal(
      SessionRecord.parse(entry).ok,
      true,
      `session log fixture entry ${entry.id} must itself be schema-admissible, or the renderer would never be handed it and nothing measured below would describe a reachable briefing`
    )
  }
}

const renderOf = (fixture: SessionFixture) =>
  renderBriefingWithPasses(fixture.thread, EMPTY_INTEGRITY, null, null, true, fixture.entries)

test('briefing.the-newest-session-entry-renders-complete-as-a-block', () => {
  const fixture = buildMultiLineFixture()
  assertFixtureAdmissible(fixture)

  const render = renderOf(fixture)

  assert.equal(
    render.passes,
    1,
    `this fixture must render unclipped in a single pass, or the completeness measured below would be describing a briefing under budget pressure rather than a briefing with room to spare; got ${render.passes} render pass(es) on a page of ${render.briefing.length} characters against a budget of ${BRIEFING_MAX_CHARS}`
  )
  assert.equal(
    render.briefing.includes(CLIP_MARKER),
    false,
    'a briefing with room to spare must shorten nothing at all, so the shortening marker must appear nowhere on the page'
  )

  const expectedBlock = escapeStoredBlock(fixture.newest.body, Number.POSITIVE_INFINITY)

  assert.ok(
    render.briefing.includes(expectedBlock),
    `the newest session entry ${fixture.newest.id} must render complete as a block, exactly as escapeStoredBlock produces it: every stored line break becomes a real line and every line carries the blockquote marker. The page does not contain that block. Expected to find:\n${expectedBlock}\nThe Last session section actually reads:\n${regionAfter(render.briefing, LAST_SESSION_HEADING).join('\n')}`
  )

  const renderedLines = render.briefing.split('\n')
  for (const blockLine of expectedBlock.split('\n')) {
    assert.ok(
      renderedLines.includes(blockLine),
      `every line of the newest session entry's block must appear as its own rendered line; the page carries no line equal to ${JSON.stringify(blockLine)}`
    )
  }

  assert.ok(
    renderedLines.includes(`${BLOCK_LINE_PREFIX}${escapeStored(lastStoredLine(fixture.newest.body))}`),
    `complete means the newest entry's LAST stored line reaches the page too, not only its first; the page carries no line equal to ${JSON.stringify(`${BLOCK_LINE_PREFIX}${escapeStored(lastStoredLine(fixture.newest.body))}`)}`
  )
})

test('briefing.every-older-session-entry-renders-as-its-first-stored-line-alone', () => {
  const fixture = buildMultiLineFixture()
  assertFixtureAdmissible(fixture)

  const render = renderOf(fixture)

  assert.equal(
    render.passes,
    1,
    `this fixture must render unclipped in a single pass, or a missing line below could be explained by budget pressure rather than by the one-line rule; got ${render.passes} render pass(es)`
  )

  const renderedLines = render.briefing.split('\n')

  for (const entry of fixture.entries) {
    assert.ok(
      render.briefing.includes(entry.id),
      `every session entry must still appear on the page one way or the other, so no implementation can satisfy the one-line rule by dropping entries; the id of entry ${entry.id} appears nowhere`
    )
  }

  for (const entry of fixture.older) {
    const mentioning = renderedLines.filter((line) => line.includes(entry.id))
    assert.equal(
      mentioning.length,
      1,
      `an older session entry must occupy exactly one rendered line; entry ${entry.id} is mentioned on ${mentioning.length} lines:\n${mentioning.join('\n')}`
    )
    assert.equal(
      mentioning[0],
      `- ${escapeStored(entry.id)} ${escapeStored(firstStoredLine(entry.body))}`,
      `an older session entry renders as its id followed by its first stored line and nothing else, where the first stored line is everything before the first stored line break in its body`
    )
    for (const hiddenLine of storedLines(entry.body).slice(1)) {
      assert.equal(
        renderedLines.some((line) => line.includes(hiddenLine)),
        false,
        `nothing after an older entry's first stored line may reach the page; text from a later line of entry ${entry.id} is on the page: ${JSON.stringify(hiddenLine)}`
      )
    }
  }
})

test('briefing.the-newest-session-entry-is-shortened-last-and-then-alone', () => {
  const fixture = buildOversizeNewestFixture()
  assertFixtureAdmissible(fixture)

  assert.ok(
    fixture.newest.body.length > BRIEFING_MAX_CHARS,
    `this fixture only exercises the priority it claims to if the newest entry alone cannot fit; its body is ${fixture.newest.body.length} characters against a budget of ${BRIEFING_MAX_CHARS}`
  )

  const render = renderOf(fixture)

  assert.ok(
    render.passes > 1,
    `an oversized newest entry must actually drive the briefing into the clip search, or nothing below is measuring a page that ever competed for space; got ${render.passes} render pass(es)`
  )
  assert.equal(
    render.withinBudget,
    true,
    `shortening the newest entry is what buys the fit, so the page must land within budget; it is ${render.briefing.length} characters against a budget of ${BRIEFING_MAX_CHARS}`
  )
  assert.ok(
    render.briefing.includes(CLIP_MARKER),
    'an oversized newest entry cannot be rendered whole, so the page must carry the shortening marker somewhere'
  )

  const newestBlockLines = regionAfter(render.briefing, LAST_SESSION_HEADING).filter((line) =>
    line.startsWith(BLOCK_LINE_PREFIX)
  )

  assert.ok(
    newestBlockLines.some((line) => line.includes(CLIP_MARKER)),
    `the newest entry is the LAST thing shortened, not the thing that can never be shortened: when it alone exceeds the budget it is shortened, and the marker lands inside its own block. This encodes a priority, not a guarantee. No blockquote line under ${LAST_SESSION_HEADING} carries the marker; the section reads:\n${regionAfter(render.briefing, LAST_SESSION_HEADING).join('\n')}`
  )

  const notShownLines = regionAfter(render.briefing, NOT_SHOWN_HEADING)
  const markerLinesElsewhere = render.briefing
    .split('\n')
    .filter((line) => line.includes(CLIP_MARKER) && !newestBlockLines.includes(line) && !notShownLines.includes(line))

  assert.deepEqual(
    markerLinesElsewhere,
    [],
    'once the newest entry is being shortened it is the only shortened thing on the page, because everything else was already shortened first or never needed to be. This encodes a priority, not a guarantee. These rendered values outside the newest entry\'s block carry the marker'
  )
})
