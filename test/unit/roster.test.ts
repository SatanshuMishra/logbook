import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  paginateRoster,
  renderRoster,
  selectRosterThreads,
  toRosterRow,
  ROSTER_BLOCKED_BY_CLIP_GRAPHEMES,
  type RosterRow,
  type RosterPage
} from '../../src/render/roster.ts'
import { escapeStored, MARKDOWN_LEADING_CHARS, TABLE_CELL_ESCAPED_CHARS } from '../../src/render/escape.ts'
import { CLIP_MARKER, clipWithMarker } from '../../src/render/clip.ts'
import type { Thread } from '../../src/schema/thread.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'

const rt = testRuntime()

const baseThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: rt.ulid(),
  slug: 'roster-fixture',
  title: 'Roster Fixture Thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the roster',
    next_step: 'write the tests',
    landed: '',
    last_session: 'wrote the renderer',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
})

const baseRow = (overrides: Partial<RosterRow> = {}): RosterRow => ({
  id: rt.ulid(),
  slug: 'roster-row-fixture',
  title: 'Roster Row Fixture',
  blocked_by: null,
  criteria_done: 0,
  criteria_total: 0,
  next_step: 'do the next thing',
  updated_at: rt.now(),
  ...overrides
})

const cellsOf = (line: string): string[] => line.split('|').slice(1, -1).map((cell) => cell.trim())

const HEADER_LINE_PATTERN = /^\|\s*#\s*\|/
const FIRST_DATA_LINE_PATTERN = /^\|\s*1\s*\|/

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

const BLOCKED_WORD_PATTERN = /\bblocked\b/i

const headerAndDataCellsOf = (rendered: string): { headerCells: string[]; dataCells: string[] } => {
  const lines = rendered.split('\n')
  const headerLine = lines.find((line) => HEADER_LINE_PATTERN.test(line))
  assert.ok(headerLine !== undefined, `expected a header line in ${JSON.stringify(rendered)}`)
  const dataLine = lines.find((line) => FIRST_DATA_LINE_PATTERN.test(line))
  assert.ok(dataLine !== undefined, `expected a first data row in ${JSON.stringify(rendered)}`)
  return { headerCells: cellsOf(headerLine as string), dataCells: cellsOf(dataLine as string) }
}

test('roster.renders-blockage-reason-in-its-own-column-when-at-or-under-the-clip-ceiling', () => {
  const thread = baseThread({ blocked_by: 'waiting on the infra approval' })
  const row = toRosterRow(thread)
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  const { headerCells, dataCells } = headerAndDataCellsOf(rendered)
  const blockedByIndex = blockedByColumnIndex(headerCells)
  assert.equal(
    dataCells.length,
    headerCells.length,
    `every data row must carry one cell per header column: ${JSON.stringify(dataCells)} against ${JSON.stringify(headerCells)}`
  )
  assert.equal(
    dataCells[blockedByIndex],
    'waiting on the infra approval',
    `a blockage reason at or under the clip ceiling must render verbatim in its own Blocked By cell: got ${JSON.stringify(dataCells[blockedByIndex])}`
  )
})

test('roster.blockage-none-when-not-blocked', () => {
  const thread = baseThread({ blocked_by: null })
  const row = toRosterRow(thread)
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  assert.equal(rendered.includes('(blocked by'), false)
  assert.equal(rendered.split('\n').some((line) => BLOCKED_WORD_PATTERN.test(line)), false)
})

test('roster.render-clips-an-over-ceiling-blockage-reason-inside-the-blocked-by-cell-without-overflowing-other-cells', () => {
  const longReason = 'x'.repeat(ROSTER_BLOCKED_BY_CLIP_GRAPHEMES + 20)
  const row = baseRow({ blocked_by: longReason })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  const { headerCells, dataCells } = headerAndDataCellsOf(rendered)
  const blockedByIndex = blockedByColumnIndex(headerCells)
  assert.equal(
    dataCells.length,
    headerCells.length,
    `every data row must carry one cell per header column: ${JSON.stringify(dataCells)} against ${JSON.stringify(headerCells)}`
  )
  assert.ok(dataCells[blockedByIndex]?.includes(CLIP_MARKER))
  assert.equal(dataCells[blockedByIndex]?.includes(longReason), false)
  assert.equal(
    dataCells[blockedByIndex + 1],
    '0 / 0 criteria',
    `the Progress cell immediately after Blocked By must not be overflowed by the clip: ${JSON.stringify(dataCells)}`
  )
})

const renderedRosterOf = (row: RosterRow): string => renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)

test('roster.render-a-closing-paren-inside-a-blockage-reason-renders-intact-in-the-blocked-by-cell-without-fracturing-the-row', () => {
  const reasonWithParen = 'waiting on the infra approval) resume it now'
  const rendered = renderedRosterOf(baseRow({ blocked_by: reasonWithParen }))
  const { headerCells, dataCells } = headerAndDataCellsOf(rendered)
  const blockedByIndex = blockedByColumnIndex(headerCells)
  assert.equal(
    dataCells.length,
    headerCells.length,
    `a closing paren inside the blockage reason must not fracture the row into a different cell count than the header: ${JSON.stringify(dataCells)}`
  )
  assert.equal(
    dataCells[blockedByIndex],
    reasonWithParen,
    `a closing paren inside the blockage reason must render intact and unshortened in its own Blocked By cell: got ${JSON.stringify(dataCells[blockedByIndex])}`
  )
})

test('roster.excludes-terminal', () => {
  const open = baseThread({ slug: 'still-open', status: 'open' })
  const done = baseThread({ slug: 'is-done', status: 'done' })
  const abandoned = baseThread({ slug: 'was-abandoned', status: 'abandoned' })

  const selected = selectRosterThreads([open, done, abandoned])
  assert.equal(selected.length, 1)
  assert.equal(selected[0]?.slug, 'still-open')
})

test('roster.orders-by-activity', () => {
  const runtime = testRuntime()
  const oldest = baseThread({ slug: 'oldest', updated_at: runtime.now() })
  const middle = baseThread({ slug: 'middle', updated_at: runtime.now() })
  const newest = baseThread({ slug: 'newest', updated_at: runtime.now() })

  const shuffled = [middle, newest, oldest]
  const selected = selectRosterThreads(shuffled)

  assert.deepEqual(
    selected.map((thread) => thread.slug),
    ['newest', 'middle', 'oldest']
  )
})

test('roster.orders-by-activity-already-descending-pair-stays-descending', () => {
  const runtime = testRuntime()
  const older = baseThread({ slug: 'older', updated_at: runtime.now() })
  const newer = baseThread({ slug: 'newer', updated_at: runtime.now() })

  const selected = selectRosterThreads([newer, older])

  assert.deepEqual(
    selected.map((thread) => thread.slug),
    ['newer', 'older']
  )
})

test('roster.select-does-not-mutate-or-reorder-the-caller-array', () => {
  const runtime = testRuntime()
  const first = baseThread({ slug: 'first', updated_at: runtime.now() })
  const second = baseThread({ slug: 'second', updated_at: runtime.now() })
  const third = baseThread({ slug: 'third', updated_at: runtime.now() })

  const original = [second, third, first]
  const snapshot = original.map((thread) => ({ ...thread }))

  const selected = selectRosterThreads(original)

  assert.deepEqual(original, snapshot)
  assert.deepEqual(
    original.map((thread) => thread.slug),
    ['second', 'third', 'first']
  )
  assert.notEqual(selected, original)
})

test('roster.to-row-counts-only-unstruck-criteria', () => {
  const thread = baseThread({
    completion_criteria: [
      { id: rt.ulid(), ordinal: 1, text: 'unstruck done one', done: true, kind: 'planned', struck_by: null },
      { id: rt.ulid(), ordinal: 2, text: 'unstruck done two', done: true, kind: 'planned', struck_by: null },
      { id: rt.ulid(), ordinal: 3, text: 'unstruck open', done: false, kind: 'planned', struck_by: null },
      { id: rt.ulid(), ordinal: 4, text: 'struck done', done: true, kind: 'detour', struck_by: rt.ulid() }
    ]
  })

  const row = toRosterRow(thread)
  assert.equal(row.criteria_total, 3)
  assert.equal(row.criteria_done, 2)
})

test('roster.to-row-maps-next-step-from-spine', () => {
  const thread = baseThread({
    spine: {
      active_goal: 'a goal',
      next_step: 'the exact next step text',
      landed: '',
      last_session: 'a session',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    }
  })
  const row = toRosterRow(thread)
  assert.equal(row.next_step, 'the exact next step text')
})

test('roster.to-row-preserves-identity-fields', () => {
  const thread = baseThread({
    id: rt.ulid(),
    slug: 'identity-check',
    title: 'Identity Check Thread',
    blocked_by: 'a blocking reason',
    updated_at: rt.now()
  })
  const row = toRosterRow(thread)
  assert.equal(row.id, thread.id)
  assert.equal(row.slug, thread.slug)
  assert.equal(row.title, thread.title)
  assert.equal(row.blocked_by, thread.blocked_by)
  assert.equal(row.updated_at, thread.updated_at)
})

const idsOf = (rows: readonly RosterRow[]): string[] => rows.map((row) => row.id)

test('roster.paginate-first-middle-and-last-page', () => {
  const rows = Array.from({ length: 7 }, (_, index) => baseRow({ id: rt.ulid(), slug: `row-${index}` }))

  const firstPage = paginateRoster(rows, null, 3)
  assert.equal(firstPage.ok, true)
  if (!firstPage.ok) return
  assert.deepEqual(idsOf(firstPage.page.rows), idsOf(rows.slice(0, 3)))
  assert.equal(firstPage.page.total, 7)
  assert.equal(firstPage.page.next_cursor, rows[2]?.id)

  const middlePage = paginateRoster(rows, firstPage.page.next_cursor, 3)
  assert.equal(middlePage.ok, true)
  if (!middlePage.ok) return
  assert.deepEqual(idsOf(middlePage.page.rows), idsOf(rows.slice(3, 6)))
  assert.equal(middlePage.page.total, 7)
  assert.equal(middlePage.page.next_cursor, rows[5]?.id)

  const lastPage = paginateRoster(rows, middlePage.page.next_cursor, 3)
  assert.equal(lastPage.ok, true)
  if (!lastPage.ok) return
  assert.deepEqual(idsOf(lastPage.page.rows), idsOf(rows.slice(6, 7)))
  assert.equal(lastPage.page.total, 7)
  assert.equal(lastPage.page.next_cursor, null)
})

test('roster.paginate-exact-multiple-boundary-has-no-next-cursor', () => {
  const rows = Array.from({ length: 6 }, (_, index) => baseRow({ id: rt.ulid(), slug: `exact-${index}` }))

  const firstPage = paginateRoster(rows, null, 3)
  assert.equal(firstPage.ok, true)
  if (!firstPage.ok) return
  assert.equal(firstPage.page.next_cursor, rows[2]?.id)

  const secondPage = paginateRoster(rows, firstPage.page.next_cursor, 3)
  assert.equal(secondPage.ok, true)
  if (!secondPage.ok) return
  assert.deepEqual(idsOf(secondPage.page.rows), idsOf(rows.slice(3, 6)))
  assert.equal(secondPage.page.total, 6)
  assert.equal(secondPage.page.next_cursor, null, 'a page that lands exactly on the population boundary must not report a next cursor')
})

test('roster.paginate-total-is-the-full-population-not-the-page-length', () => {
  const rows = Array.from({ length: 5 }, (_, index) => baseRow({ id: rt.ulid(), slug: `total-${index}` }))
  const page = paginateRoster(rows, null, 2)
  assert.equal(page.ok, true)
  if (!page.ok) return
  assert.equal(page.page.rows.length, 2)
  assert.equal(page.page.total, 5)
})

test('roster.paginate-zero-limit-yields-an-empty-page-with-no-next-cursor', () => {
  const rows = Array.from({ length: 4 }, (_, index) => baseRow({ id: rt.ulid(), slug: `zero-limit-${index}` }))
  const page = paginateRoster(rows, null, 0)
  assert.equal(page.ok, true)
  if (!page.ok) return
  assert.deepEqual(page.page.rows, [])
  assert.equal(page.page.next_cursor, null)
  assert.equal(page.page.total, 4)
})

test('roster.paginate-unknown-cursor-is-refused-not-restarted', () => {
  const rows = Array.from({ length: 3 }, (_, index) => baseRow({ id: rt.ulid(), slug: `unknown-${index}` }))
  const result = paginateRoster(rows, 'a-cursor-that-does-not-exist', 2)
  assert.deepEqual(result, { ok: false, reason: 'unknown-cursor' })
})

test('roster.render-escapes-every-stored-free-text-field', () => {
  const row = baseRow({
    title: '# heading title\nsecond line',
    slug: 'escape-fixture',
    blocked_by: '# heading blockage\nsecond line'
  })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)

  assert.equal(/(^|\n)#{1,6}\s/.test(rendered), false)

  const expectedThreadNameCell = escapeStored(`${escapeStored(row.slug)} - ${escapeStored(row.title)}`, 'table-cell')
  assert.ok(rendered.includes(`| ${expectedThreadNameCell} |`))

  const expectedBlockedByCell = escapeStored(
    clipWithMarker(escapeStored(row.blocked_by ?? ''), ROSTER_BLOCKED_BY_CLIP_GRAPHEMES),
    'table-cell'
  )
  assert.ok(rendered.includes(`| ${expectedBlockedByCell} |`))
})

test('roster.render-omits-next-step-from-the-rendered-text', () => {
  const distinctiveNextStep = 'zz-distinctive-next-step-marker-8f2c1a'
  const row = baseRow({ next_step: distinctiveNextStep })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  assert.equal(rendered.includes(distinctiveNextStep), false)
})

test('roster.render-escapes-the-identifier-timestamp-and-cursor-fields', () => {
  const row = baseRow({
    id: '01ARZ\u2028TAIL',
    slug: 'identifier-fixture',
    updated_at: '2024-01-01T00:00:05.000Z\nX'
  })
  const rendered = renderRoster({ rows: [row], next_cursor: '#cursor\u2028tail', total: 2 }, 0)

  assert.ok(rendered.includes(`| ${escapeStored(row.id)} |`))
  assert.ok(rendered.includes('| 2024-01-01T00:00:05.000ZU+000AX |'))
  assert.ok(rendered.includes('Next cursor: U+0023cursorU+2028tail'))
  assert.equal(rendered.includes('\u2028'), false)
  assert.equal(rendered.includes('01ARZ\u2028TAIL'), false)
})

test('roster.render-last-activity-falls-back-to-the-stored-value-verbatim-when-it-does-not-match-the-exact-iso-shape', () => {
  const nonIsoUpdatedAt = '2024-01-01 00:00:05'
  const row = baseRow({ updated_at: nonIsoUpdatedAt })

  let rendered = ''
  assert.doesNotThrow(() => {
    rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  })

  const { headerCells, dataCells } = headerAndDataCellsOf(rendered)
  const lastActivityIndex = headerCells.indexOf('Last Activity')
  assert.notEqual(
    lastActivityIndex,
    -1,
    `expected a 'Last Activity' header cell among ${JSON.stringify(headerCells)}`
  )
  assert.equal(
    dataCells.length,
    headerCells.length,
    `every data row must carry one cell per header column: ${JSON.stringify(dataCells)} against ${JSON.stringify(headerCells)}`
  )
  assert.equal(dataCells[lastActivityIndex], nonIsoUpdatedAt)
  assert.equal(dataCells[lastActivityIndex]?.includes('Invalid Date'), false)
  assert.notEqual(dataCells[lastActivityIndex], '')
})

test('roster.render-pipe-in-any-free-text-field-does-not-fracture-the-table-row', () => {
  const fieldsWithPipes: Array<Partial<RosterRow>> = [
    { title: 'alpha | beta' },
    { slug: 'alpha|beta' },
    { blocked_by: 'alpha | beta' }
  ]

  for (const overrides of fieldsWithPipes) {
    const row = baseRow(overrides)
    const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
    const lines = rendered.split('\n')
    const headerLine = lines.find((line) => HEADER_LINE_PATTERN.test(line))
    const dataLine = lines.find((line) => FIRST_DATA_LINE_PATTERN.test(line))
    assert.ok(headerLine !== undefined, `expected a header line for overrides ${JSON.stringify(overrides)}`)
    assert.ok(dataLine !== undefined, `expected a data line for overrides ${JSON.stringify(overrides)}`)
    assert.equal(
      cellsOf(dataLine as string).length,
      cellsOf(headerLine as string).length,
      `pipe in ${JSON.stringify(overrides)} must not change the row's cell count`
    )
  }
})

test('roster.render-clipped-blockage-reason-with-a-pipe-near-the-clip-boundary-keeps-the-pipe-token-whole', () => {
  const carrierBeforePipe = 'x'.repeat(44)
  const carrierAfterPipe = 'x'.repeat(25)
  const longReasonWithPipe = `${carrierBeforePipe}|${carrierAfterPipe}`
  assert.ok(
    longReasonWithPipe.length > ROSTER_BLOCKED_BY_CLIP_GRAPHEMES,
    'the reason must exceed the clip ceiling for this case to exercise clipping'
  )
  const row = baseRow({ blocked_by: longReasonWithPipe })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  const { headerCells, dataCells } = headerAndDataCellsOf(rendered)
  const blockedByIndex = blockedByColumnIndex(headerCells)
  assert.equal(
    dataCells.length,
    headerCells.length,
    `every data row must carry one cell per header column: ${JSON.stringify(dataCells)} against ${JSON.stringify(headerCells)}`
  )
  assert.ok(dataCells[blockedByIndex]?.includes(CLIP_MARKER))
  assert.ok(
    dataCells[blockedByIndex]?.includes('U+007C'),
    'the clipped pipe must survive as a whole U+007C token, not a truncated fragment'
  )
})

test('roster.render-clip-marker-survives-the-outer-table-cell-escape-pass-byte-for-byte', () => {
  const longReason = 'x'.repeat(ROSTER_BLOCKED_BY_CLIP_GRAPHEMES + 20)
  const row = baseRow({ blocked_by: longReason })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  const { headerCells, dataCells } = headerAndDataCellsOf(rendered)
  const blockedByIndex = blockedByColumnIndex(headerCells)
  assert.equal(
    dataCells.length,
    headerCells.length,
    `every data row must carry one cell per header column: ${JSON.stringify(dataCells)} against ${JSON.stringify(headerCells)}`
  )
  assert.ok(
    dataCells[blockedByIndex]?.endsWith(CLIP_MARKER),
    `expected the clip marker to sit intact at the end of the Blocked By cell, got ${JSON.stringify(dataCells[blockedByIndex])}`
  )
  assert.equal(
    dataCells[blockedByIndex]?.includes('U+005B'),
    false,
    'the marker leading [ never sits at a line start mid-cell, so the outer table-cell escape pass must leave it unescaped'
  )
})

test('roster.render-pipe-expansion-after-the-clip-overruns-the-blockage-budget-by-design', () => {
  const carrierWithPipes = 'a|b|c|d|e|f|g|h|'
  const carrierTail = 'z'.repeat(60)
  const longReasonWithPipes = `${carrierWithPipes}${carrierTail}`
  const pipeCount = (longReasonWithPipes.match(/\|/g) ?? []).length
  assert.equal(pipeCount, 8)
  const row = baseRow({ blocked_by: longReasonWithPipes })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  const { headerCells, dataCells } = headerAndDataCellsOf(rendered)
  const blockedByIndex = blockedByColumnIndex(headerCells)
  assert.equal(
    dataCells.length,
    headerCells.length,
    `every data row must carry one cell per header column: ${JSON.stringify(dataCells)} against ${JSON.stringify(headerCells)}`
  )
  const blockedBySegment = dataCells[blockedByIndex] as string
  const survivingPipeTokens = (blockedBySegment.match(/U\+007C/g) ?? []).length
  assert.equal(
    survivingPipeTokens,
    pipeCount,
    'every pipe ahead of the clip boundary must land inside the clipped window for this case to measure the overrun'
  )
  assert.equal(
    graphemeCount(blockedBySegment),
    ROSTER_BLOCKED_BY_CLIP_GRAPHEMES + 5 * survivingPipeTokens,
    'the clip sizes the text to the 60-grapheme budget before the outer pass turns each 1-grapheme pipe into the 6-grapheme U+007C token, so the finished segment runs 5 graphemes over budget per surviving pipe by design'
  )
})

test('roster.render-single-row-exact-output', () => {
  const row: RosterRow = {
    id: rt.ulid(),
    slug: 'exact-output',
    title: 'Exact Output Thread',
    blocked_by: null,
    criteria_done: 2,
    criteria_total: 5,
    next_step: 'ship the next step',
    updated_at: '2024-01-01T00:00:05.000Z'
  }
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  const expected = [
    'Roster: 1 of 1 resumable thread.',
    [
      '| # | Thread ID | Thread Name | Progress | Last Activity |',
      '| --- | --- | --- | --- | --- |',
      `| 1 | ${row.id} | exact-output - Exact Output Thread | 2 / 5 criteria | 2024-01-01 00:00 UTC |`
    ].join('\n'),
    'No further pages.'
  ].join('\n\n')
  assert.equal(rendered, expected)
})

test('roster.render-six-column-header-and-separator-are-byte-exact-when-a-row-is-blocked', () => {
  const row = baseRow({ blocked_by: 'waiting on the infra approval' })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 0)
  const lines = rendered.split('\n')
  const headerLine = lines.find((line) => HEADER_LINE_PATTERN.test(line))
  assert.ok(headerLine !== undefined, `expected a header line in ${JSON.stringify(rendered)}`)
  const headerIndex = lines.indexOf(headerLine as string)
  assert.equal(
    headerLine,
    '| # | Thread ID | Thread Name | Blocked By | Progress | Last Activity |',
    `the six-column header must spell every column name byte-exact, or a drifted column name passes silently: got ${JSON.stringify(headerLine)}`
  )
  assert.equal(
    lines[headerIndex + 1],
    '| --- | --- | --- | --- | --- | --- |',
    `the six-column separator must carry one --- per column, or the header and data cells fall out of alignment: got ${JSON.stringify(lines[headerIndex + 1])}`
  )
})

test('roster.render-header-uses-plural-threads-when-total-is-not-one', () => {
  const zeroRows = renderRoster({ rows: [], next_cursor: null, total: 0 }, 0)
  assert.ok(zeroRows.split('\n')[0]?.includes('0 resumable threads.'))

  const row = baseRow()
  const twoTotal = renderRoster({ rows: [row], next_cursor: null, total: 2 }, 0)
  assert.ok(twoTotal.split('\n')[0]?.includes('1 of 2 resumable threads.'))
})

test('roster.render-empty-page-joins-header-and-footer-with-a-single-newline', () => {
  const rendered = renderRoster({ rows: [], next_cursor: null, total: 0 }, 0)
  assert.equal(rendered, 'Roster: 0 of 0 resumable threads.\nNo further pages.')
})

const tableDataLinesOf = (rendered: string, rowCount: number): string[] => {
  const tableBlock = rendered.split('\n\n')[1] ?? ''
  return tableBlock.split('\n').slice(2, 2 + rowCount)
}

test('roster.render-numbers-rows-1-based-within-the-page-and-restarts-at-1-on-a-later-page', () => {
  const rows = Array.from({ length: 4 }, (_, index) => baseRow({ id: rt.ulid(), slug: `numbered-${index}` }))

  const firstPageResult = paginateRoster(rows, null, 2)
  assert.equal(firstPageResult.ok, true)
  if (!firstPageResult.ok) return
  const firstRendered = renderRoster(firstPageResult.page, 0)
  const firstDataLines = tableDataLinesOf(firstRendered, 2)
  assert.equal(cellsOf(firstDataLines[0] as string)[0], '1')
  assert.equal(cellsOf(firstDataLines[1] as string)[0], '2')

  const secondPageResult = paginateRoster(rows, firstPageResult.page.next_cursor, 2)
  assert.equal(secondPageResult.ok, true)
  if (!secondPageResult.ok) return
  const secondRendered = renderRoster(secondPageResult.page, 0)
  const secondDataLines = tableDataLinesOf(secondRendered, 2)
  assert.equal(
    cellsOf(secondDataLines[0] as string)[0],
    '1',
    'a later page must restart its own row numbering at 1 rather than continuing a global count'
  )
  assert.equal(
    cellsOf(secondDataLines[1] as string)[0],
    '2',
    'a later page must restart its own row numbering at 1 rather than continuing a global count'
  )
})

test('roster.render-keeps-multiple-rows-within-a-single-table-block', () => {
  const rowOne = baseRow({ id: rt.ulid(), slug: 'row-one' })
  const rowTwo = baseRow({ id: rt.ulid(), slug: 'row-two' })
  const rendered = renderRoster({ rows: [rowOne, rowTwo], next_cursor: 'a-cursor', total: 2 }, 0)
  const segments = rendered.split('\n\n')
  assert.equal(segments.length, 3)
  const tableLines = segments[1]?.split('\n') ?? []
  assert.equal(tableLines.length, 4)
  assert.equal(segments[segments.length - 1], 'Next cursor: a-cursor')
})

test('roster.render-with-zero-excluded-is-byte-identical-to-no-exclusion', () => {
  const page = { rows: [], next_cursor: null, total: 0 }
  assert.equal(renderRoster(page, 0), 'Roster: 0 of 0 resumable threads.\nNo further pages.')
})

test('roster.render-names-the-excluded-count-and-address-when-above-zero', () => {
  const singular = renderRoster({ rows: [], next_cursor: null, total: 0 }, 1)
  const singularLines = singular.split('\n')
  assert.equal(singularLines[0], 'Roster: 0 of 0 resumable threads.')
  assert.equal(singularLines[1], 'Excluded: 1 terminal thread not shown; read it at logbook://thread/{id}.')
  assert.equal(singularLines[2], 'No further pages.')

  const plural = renderRoster({ rows: [], next_cursor: null, total: 0 }, 2)
  const pluralLines = plural.split('\n')
  assert.equal(pluralLines[1], 'Excluded: 2 terminal threads not shown; read one at logbook://thread/{id}.')

  const row = baseRow()
  const withRows = renderRoster({ rows: [row], next_cursor: null, total: 1 }, 3)
  const withRowsLines = withRows.split('\n')
  assert.equal(withRowsLines[0], 'Roster: 1 of 1 resumable thread.')
  assert.equal(withRowsLines[1], 'Excluded: 3 terminal threads not shown; read one at logbook://thread/{id}.')
})

const nthDataLinePattern = (rowNumber: number): RegExp => new RegExp(`^\\|\\s*${rowNumber}\\s*\\|`)

const dataLineOf = (rendered: string, rowNumber: number): string => {
  const line = rendered.split('\n').find((candidate) => nthDataLinePattern(rowNumber).test(candidate))
  assert.ok(line !== undefined, `expected a data row numbered ${rowNumber} in ${JSON.stringify(rendered)}`)
  return line as string
}

const blockedByColumnIndex = (headerCells: readonly string[]): number => {
  const index = headerCells.indexOf('Blocked By')
  assert.notEqual(
    index,
    -1,
    `expected a 'Blocked By' header cell among ${JSON.stringify(headerCells)}, or the blockage reason has nowhere of its own to render and a reader must go on trusting the thread-name cell's own claim about being blocked`
  )
  return index
}

test('roster.blockage-reason-renders-in-its-own-column-not-inline-in-the-thread-name-cell', () => {
  const sharedSlug = 'shared-slug-for-forgery-check'
  const forgingReasonText = 'waiting on the infra approval'
  const rowA = baseRow({
    slug: sharedSlug,
    title: `Ordinary Title (blocked by ${forgingReasonText})`,
    blocked_by: null
  })
  const rowB = baseRow({
    slug: sharedSlug,
    title: 'Ordinary Title',
    blocked_by: forgingReasonText
  })

  const rendered = renderRoster({ rows: [rowA, rowB], next_cursor: null, total: 2 }, 0)
  const lines = rendered.split('\n')
  const headerLine = lines.find((line) => HEADER_LINE_PATTERN.test(line))
  assert.ok(headerLine !== undefined, `expected a header row to locate the Blocked By column against, but no line matched the header pattern in: ${JSON.stringify(rendered)}`)
  const headerCells = cellsOf(headerLine as string)
  const blockedByIndex = blockedByColumnIndex(headerCells)

  const rowACells = cellsOf(dataLineOf(rendered, 1))
  const rowBCells = cellsOf(dataLineOf(rendered, 2))

  assert.equal(
    rowACells.length,
    headerCells.length,
    `row A must carry one cell per header column, or a reader has no way to line its Blocked By cell up with the header at all: row A read ${JSON.stringify(rowACells)} against header ${JSON.stringify(headerCells)}`
  )
  assert.equal(
    rowBCells.length,
    headerCells.length,
    `row B must carry one cell per header column, or a reader has no way to line its Blocked By cell up with the header at all: row B read ${JSON.stringify(rowBCells)} against header ${JSON.stringify(headerCells)}`
  )

  assert.equal(
    rowACells[blockedByIndex],
    '',
    `row A is not blocked, so its Blocked By cell must be empty, or a reader is told about a blockage that does not exist: row A read ${JSON.stringify(rowACells)}`
  )
  assert.notEqual(
    rowBCells[blockedByIndex],
    '',
    `row B is genuinely blocked, so its Blocked By cell must not be empty, or a reader cannot tell it is blocked at all: row B read ${JSON.stringify(rowBCells)}`
  )
  assert.ok(
    rowBCells[blockedByIndex]?.includes(forgingReasonText),
    `row B's Blocked By cell must contain its own stored reason, or the reason is lost between the store and the table: row B's cell read ${JSON.stringify(rowBCells[blockedByIndex])}`
  )

  const rowAPair = [rowACells[2], rowACells[blockedByIndex]]
  const rowBPair = [rowBCells[2], rowBCells[blockedByIndex]]
  assert.notDeepEqual(
    rowAPair,
    rowBPair,
    `row A's title-forged blockage phrase and row B's genuine blockage must render as distinguishable thread-name/Blocked-By pairs, or a title can still forge a blockage the store never recorded: row A read ${JSON.stringify(rowAPair)}, row B read ${JSON.stringify(rowBPair)}`
  )

  assert.equal(
    rowBCells[2]?.includes(forgingReasonText),
    false,
    `row B's Thread Name cell must not carry its own blockage reason inline, or a reader who only reads the Thread Name cell sees the exact leaked phrase the Blocked By column exists to keep out of it: row B's Thread Name cell read ${JSON.stringify(rowBCells[2])}`
  )
})

const assertBlankBlockageReasonRendersAsBlocked = (blankReason: string): void => {
  const unblockedRow = baseRow({ slug: 'blank-reason-unblocked', title: 'Unblocked Row', blocked_by: null })
  const genuinelyBlockedRow = baseRow({
    slug: 'blank-reason-control',
    title: 'Control Blocked Row',
    blocked_by: 'a genuine blockage reason'
  })
  const blankReasonRow = baseRow({ slug: 'blank-reason-fixture', title: 'Blank Reason Row', blocked_by: blankReason })

  const rendered = renderRoster(
    { rows: [unblockedRow, genuinelyBlockedRow, blankReasonRow], next_cursor: null, total: 3 },
    0
  )
  const lines = rendered.split('\n')
  const headerLine = lines.find((line) => HEADER_LINE_PATTERN.test(line))
  assert.ok(
    headerLine !== undefined,
    `expected a header line for blank reason ${JSON.stringify(blankReason)}: ${JSON.stringify(rendered)}`
  )
  const headerCells = cellsOf(headerLine as string)
  const blockedByIndex = blockedByColumnIndex(headerCells)

  const unblockedCells = cellsOf(dataLineOf(rendered, 1))
  const blankReasonCells = cellsOf(dataLineOf(rendered, 3))

  assert.equal(
    unblockedCells[blockedByIndex],
    '',
    `sanity check for blank reason ${JSON.stringify(blankReason)}: an unblocked row's Blocked By cell must be empty, or this test's own baseline is wrong: ${JSON.stringify(unblockedCells)}`
  )
  assert.notEqual(
    blankReasonCells[blockedByIndex],
    '',
    `a thread blocked with a blank reason (${JSON.stringify(blankReason)}) must still render a non-empty Blocked By cell, or a reader cannot tell it apart from a thread that was never blocked at all: ${JSON.stringify(blankReasonCells)}`
  )
  assert.notEqual(
    blankReasonCells[blockedByIndex],
    unblockedCells[blockedByIndex],
    `a blank-reason blocked row's Blocked By cell must read as distinguishable from an unblocked row's cell for blank reason ${JSON.stringify(blankReason)}, or a reader cannot tell the two apart: blocked read ${JSON.stringify(blankReasonCells[blockedByIndex])}, unblocked read ${JSON.stringify(unblockedCells[blockedByIndex])}`
  )
}

test('roster.blockage-reason-that-is-a-bare-space-still-marks-the-row-as-blocked', () => {
  assertBlankBlockageReasonRendersAsBlocked(' ')
})

test('roster.blockage-reason-that-is-an-empty-string-still-marks-the-row-as-blocked', () => {
  assertBlankBlockageReasonRendersAsBlocked('')
})

type HostileTitleCase = { title: string; includeGenuineBlockedRow: boolean }

type RenderRosterFn = (page: RosterPage, excludedByRelevance: number) => string

const classifyHostileTitle = (
  hostileCase: HostileTitleCase,
  renderFn: RenderRosterFn = renderRoster
): Classified<HostileTitleCase>['verdict'] | 'unclassifiable' => {
  const unblockedRow = baseRow({ slug: 'hostile-forgery-fixture', title: hostileCase.title, blocked_by: null })
  const rows = hostileCase.includeGenuineBlockedRow
    ? [unblockedRow, baseRow({ slug: 'hostile-forgery-control', title: 'Control Title', blocked_by: 'a genuine blockage reason' })]
    : [unblockedRow]
  const rendered = renderFn({ rows, next_cursor: null, total: rows.length }, 0)
  const lines = rendered.split('\n')

  const headerLine = lines.find((line) => HEADER_LINE_PATTERN.test(line))
  if (headerLine === undefined) return 'unclassifiable'
  const headerCells = cellsOf(headerLine)
  const blockedByIndex = headerCells.indexOf('Blocked By')
  if (blockedByIndex === -1) return 'unclassifiable'

  const rowLine = lines.find((line) => FIRST_DATA_LINE_PATTERN.test(line))
  if (rowLine === undefined) return 'unclassifiable'
  const rowCells = cellsOf(rowLine)
  if (rowCells.length !== headerCells.length) return 'unclassifiable'

  const blockageCell = rowCells[blockedByIndex]
  if (blockageCell === undefined) return 'unclassifiable'
  return blockageCell === '' ? 'allowed' : 'forbidden'
}

test('roster.blockage-column-resists-a-closed-census-of-titles-that-try-to-forge-the-blockage-marker-through-guard-characters', () => {
  const forgedPhrase = 'blocked by waiting on the infra approval'

  const guardCharacterTitles: HostileTitleCase[] = [
    ...Array.from(MARKDOWN_LEADING_CHARS, (guardChar): HostileTitleCase => ({
      title: `${guardChar}${forgedPhrase}${guardChar}`,
      includeGenuineBlockedRow: true
    })),
    ...Array.from(TABLE_CELL_ESCAPED_CHARS, (guardChar): HostileTitleCase => ({
      title: `${guardChar}${forgedPhrase}${guardChar}`,
      includeGenuineBlockedRow: true
    }))
  ]

  const hostileTitleCases: HostileTitleCase[] = [
    ...guardCharacterTitles,
    { title: 'Ordinary Title (blocked by waiting on the infra approval)', includeGenuineBlockedRow: true }
  ]

  assert.doesNotThrow(
    () => census(hostileTitleCases, classifyHostileTitle),
    `every hostile title must render an empty Blocked By cell for the row it belongs to, or a title alone can still masquerade as a genuinely blocked thread: ${JSON.stringify(hostileTitleCases)}`
  )

  const syntheticUnclassifiable: HostileTitleCase[] = [
    { title: 'no genuinely blocked row shares this page, so no Blocked By column exists to check at all', includeGenuineBlockedRow: false }
  ]
  assert.throws(
    () => census(syntheticUnclassifiable, classifyHostileTitle),
    `census must halt when there is no Blocked By column to check the row against, or it silently passes an item it never actually classified`
  )
})

test('roster.blockage-column-census-halts-as-forbidden-when-a-render-bug-leaks-a-hostile-title-into-the-blocked-by-cell', () => {
  const forgedPhrase = 'blocked by waiting on the infra approval'

  const renderRosterThatLeaksTheTitleIntoBlockedBy: RenderRosterFn = (page, excludedByRelevance) => {
    const row = page.rows[0]
    if (row === undefined) return renderRoster(page, excludedByRelevance)
    const header = '| # | Thread ID | Thread Name | Blocked By | Progress | Last Activity |'
    const separator = '| --- | --- | --- | --- | --- | --- |'
    const dataLine = `| 1 | ${row.id} | ${row.slug} - ${row.title} | ${row.title} | ${row.criteria_done} / ${row.criteria_total} criteria | ${row.updated_at} |`
    return [
      `Roster: ${page.rows.length} of ${page.total} resumable thread${page.total === 1 ? '' : 's'}.`,
      [header, separator, dataLine].join('\n'),
      'No further pages.'
    ].join('\n\n')
  }

  const forgingCase: HostileTitleCase = {
    title: `Ordinary Title (${forgedPhrase})`,
    includeGenuineBlockedRow: true
  }

  assert.throws(
    () => census([forgingCase], (hostileCase) => classifyHostileTitle(hostileCase, renderRosterThatLeaksTheTitleIntoBlockedBy)),
    (error: unknown) => {
      assert.ok(error instanceof Error, 'the census must halt by throwing an Error')
      assert.ok(
        error.message.includes('forbidden item'),
        `a render bug that leaks a hostile title into the Blocked By cell must halt the census as forbidden, or the forbidden branch is never actually reachable and the census only ever proves the column exists: got ${error.message}`
      )
      assert.ok(
        !error.message.includes('unclassifiable item'),
        `the halt must be reported as forbidden, not unclassifiable, or a reviewer chasing this failure investigates a missing column instead of a leaked title: got ${error.message}`
      )
      return true
    }
  )
})
