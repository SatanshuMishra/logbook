import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefingWithPasses, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import {
  SPINE_ACTIVE_GOAL_MAX,
  SPINE_LANDED_MAX,
  SPINE_LAST_SESSION_MAX,
  SPINE_NEXT_STEP_MAX,
  THREAD_BLOCKED_BY_MAX,
  THREAD_TITLE_MAX
} from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'
import { overBudgetThread } from '../support/briefing-over-budget-fixture.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const THREAD_PREFIX = '**Thread:** '
const BLOCKED_PREFIX = '**Blocked:** '
const ACTIVE_GOAL_HEADING = '**Active goal:**'
const LAST_SESSION_HEADING = '**Last session:**'
const LANDED_HEADING = '**Landed:**'
const NEXT_STEP_HEADING = '**Next step:**'
const QUOTE_PREFIX = '> '

const NOT_SHOWN_HEADING = '**Not shown:**'

const TEXT_CLIPPED_BULLET = `- some text on this briefing was shortened to fit the size budget for one reply; every shortened value ends with ${CLIP_MARKER}`

const completeRecordLine = (threadId: string): string =>
  `See logbook://thread/${escapeStored(threadId)} for the complete record.`

const HEADER_FIELD_RENDERED_GRAPHEME_MAX = 500

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

const HEADER_FIELD_NAMES = ['title', 'blocked_by', 'active_goal', 'last_session', 'landed', 'next_step'] as const

type HeaderField = (typeof HEADER_FIELD_NAMES)[number]

const HEADER_FIELD_FILLS: Readonly<Record<HeaderField, string>> = {
  title: 't',
  blocked_by: 'b',
  active_goal: 'g',
  last_session: 's',
  landed: 'd',
  next_step: 'x'
}

const HEADER_FIELD_WRITE_CAPS: Readonly<Record<HeaderField, number>> = {
  title: THREAD_TITLE_MAX,
  blocked_by: THREAD_BLOCKED_BY_MAX,
  active_goal: SPINE_ACTIVE_GOAL_MAX,
  last_session: SPINE_LAST_SESSION_MAX,
  landed: SPINE_LANDED_MAX,
  next_step: SPINE_NEXT_STEP_MAX
}

const storedAtWriteCap = (field: HeaderField): string =>
  HEADER_FIELD_FILLS[field].repeat(HEADER_FIELD_WRITE_CAPS[field])

const assertFillEscapesOneToOne = (field: HeaderField): void => {
  const stored = storedAtWriteCap(field)
  const escaped = escapeStored(stored)
  if (escaped !== stored) {
    throw new Error(
      `the ${field} filler must survive the stored-text escape unchanged for this test to compare a rendered value against a stored one; ${HEADER_FIELD_FILLS[field]} escapes to ${escapeStored(HEADER_FIELD_FILLS[field])} and ${HEADER_FIELD_WRITE_CAPS[field]} stored characters became ${escaped.length} rendered ones`
    )
  }
}

const headerFieldsAtWriteCaps = (): Thread => ({
  id: rt.ulid(),
  slug: 'header-fields-at-their-write-caps',
  title: storedAtWriteCap('title'),
  status: 'open',
  blocked_by: storedAtWriteCap('blocked_by'),
  completion_criteria: [],
  spine: {
    active_goal: storedAtWriteCap('active_goal'),
    next_step: storedAtWriteCap('next_step'),
    landed: storedAtWriteCap('landed'),
    last_session: storedAtWriteCap('last_session'),
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const lineAfterPrefix = (lines: readonly string[], prefix: string): string => {
  const line = lines.find((entry) => entry.startsWith(prefix))
  if (line === undefined) {
    throw new Error(
      `the briefing carries no line starting with ${prefix}, so the header field it renders cannot be read; the header layout changed and this test no longer reaches what it asserts on`
    )
  }
  return line.slice(prefix.length)
}

const quotedBlockAfterHeading = (lines: readonly string[], heading: string): string => {
  const headingAt = lines.indexOf(heading)
  if (headingAt === -1) {
    throw new Error(
      `the briefing carries no ${heading} heading, so the header field beneath it cannot be read; the header layout changed and this test no longer reaches what it asserts on`
    )
  }
  const afterHeading = lines.slice(headingAt + 1)
  const blockStart = afterHeading.findIndex((entry) => entry.startsWith(QUOTE_PREFIX))
  if (blockStart === -1) {
    throw new Error(
      `the briefing carries no quoted block under ${heading}, so the header field beneath it cannot be read; the header layout changed and this test no longer reaches what it asserts on`
    )
  }
  const fromBlockStart = afterHeading.slice(blockStart)
  const blockEnd = fromBlockStart.findIndex((entry) => !entry.startsWith(QUOTE_PREFIX))
  const block = blockEnd === -1 ? fromBlockStart : fromBlockStart.slice(0, blockEnd)
  return block.map((entry) => entry.slice(QUOTE_PREFIX.length)).join('\n')
}

const readHeaderField = (lines: readonly string[], field: HeaderField): string => {
  switch (field) {
    case 'title':
      return lineAfterPrefix(lines, THREAD_PREFIX)
    case 'blocked_by':
      return lineAfterPrefix(lines, BLOCKED_PREFIX)
    case 'active_goal':
      return quotedBlockAfterHeading(lines, ACTIVE_GOAL_HEADING)
    case 'last_session':
      return quotedBlockAfterHeading(lines, LAST_SESSION_HEADING)
    case 'landed':
      return quotedBlockAfterHeading(lines, LANDED_HEADING)
    case 'next_step':
      return quotedBlockAfterHeading(lines, NEXT_STEP_HEADING)
    default: {
      const exhaustive: never = field
      throw new Error(`this test has no reader for the header field ${String(exhaustive)}`)
    }
  }
}

test('briefing.header-fields-of-escape-expanding-text-render-inside-the-budget', () => {
  const render = renderBriefingWithPasses(overBudgetThread(rt), EMPTY_INTEGRITY, null, null)

  assert.equal(
    render.withinBudget,
    true,
    `header fields held at their write caps and filled with a character the stored-text escape rewrites into a six-character token must still render inside the briefing budget, or a resume of that thread returns a reply no caller can use; got a render of ${render.briefing.length} characters reported as outside budget`
  )
})

test('briefing.every-header-field-of-escape-expanding-text-is-shortened-to-the-header-cap', () => {
  const render = renderBriefingWithPasses(overBudgetThread(rt), EMPTY_INTEGRITY, null, null)
  const lines = render.briefing.split('\n')

  assert.deepEqual(
    HEADER_FIELD_NAMES.map((field) => {
      const rendered = readHeaderField(lines, field)
      return [field, graphemeCount(rendered), rendered.endsWith(CLIP_MARKER)]
    }),
    HEADER_FIELD_NAMES.map((field) => [field, HEADER_FIELD_RENDERED_GRAPHEME_MAX, true]),
    `every one of the six header fields must be shortened to ${HEADER_FIELD_RENDERED_GRAPHEME_MAX} graphemes measured after the stored-text escape, and must end with ${CLIP_MARKER} so the reader can see where the value was cut; a row here whose count is larger names a field whose cap no longer fires, and one field left uncapped is enough to push a record of ordinary size past the reply budget while the other five hide it`
  )
})

test('briefing.a-header-field-the-renderer-shortened-is-disclosed-even-when-the-render-then-fits', () => {
  const thread = overBudgetThread(rt)
  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, null)

  assert.equal(
    render.withinBudget,
    true,
    'this fixture must render inside its budget, or it says nothing about a render that fits and was still shortened'
  )
  assert.equal(
    render.briefing.includes(CLIP_MARKER),
    true,
    `this fixture must carry ${CLIP_MARKER}, or there is no shortening for the briefing to disclose and this test asserts nothing`
  )

  assert.deepEqual(
    {
      notShownHeading: render.briefing.includes(NOT_SHOWN_HEADING),
      shortenedBullet: render.briefing.includes(TEXT_CLIPPED_BULLET),
      endsWithRecordAddress: render.briefing.endsWith(completeRecordLine(thread.id))
    },
    { notShownHeading: true, shortenedBullet: true, endsWithRecordAddress: true },
    `a briefing carrying ${CLIP_MARKER} must say so under ${NOT_SHOWN_HEADING} and must end with the address that resolves to the complete record, whether the shortening came from the clip search or from a header field cap; a false here is a briefing that withheld text from the reader and told them nothing, leaving them to read a truncated value as the whole one`
  )
})

test('briefing.header-fields-whose-escape-is-the-identity-render-whole-at-their-write-caps', () => {
  for (const field of HEADER_FIELD_NAMES) assertFillEscapesOneToOne(field)

  const thread = headerFieldsAtWriteCaps()
  const admitted = ThreadRecord.parse(thread)
  if (!admitted.ok) {
    throw new Error(
      `the plain-text header fixture must itself be schema-admissible for this test to describe a record the store can hold: ${admitted.message}`
    )
  }

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, null)
  const lines = render.briefing.split('\n')

  assert.deepEqual(
    HEADER_FIELD_NAMES.map((field) => {
      const rendered = readHeaderField(lines, field)
      return [field, rendered.length, rendered === storedAtWriteCap(field)]
    }),
    HEADER_FIELD_NAMES.map((field) => [field, HEADER_FIELD_WRITE_CAPS[field], true]),
    `a header field whose stored value already sits at its write cap and escapes one character to one character must render whole; a short length or a false here names a field the renderer shortened for no reason, and a shortened value ends with ${CLIP_MARKER} while the briefing now under-reports what the record holds`
  )
})
