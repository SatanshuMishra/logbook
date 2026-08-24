import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import {
  paginateRoster,
  renderRoster,
  selectRosterThreads,
  toRosterRow,
  type RosterRow
} from '../../src/render/roster.ts'
import { escapeStored } from '../../src/render/escape.ts'
import type { Thread } from '../../src/schema/thread.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, sourceFileFor } from '../support/source-census.ts'

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

const BLOCKED_WORD_PATTERN = /\bblocked\b/i

type BlockedCandidate = { line: number; hasInterpolation: boolean }

const isTemplateSpanPart = (node: ts.Node): boolean =>
  ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)

const belongsToInterpolatedTemplate = (node: ts.Node): boolean =>
  isTemplateSpanPart(node) && ts.isTemplateExpression(node.parent)

const collectBlockedCandidates = (sourceFile: ts.SourceFile): BlockedCandidate[] => {
  const found: BlockedCandidate[] = []
  forEachDescendant(sourceFile, (node) => {
    const isLiteralWithText =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || isTemplateSpanPart(node)
    if (!isLiteralWithText) return
    const raw = node.getText(sourceFile)
    if (!BLOCKED_WORD_PATTERN.test(raw)) return
    const line = lineOf(sourceFile, node)
    found.push({ line, hasInterpolation: belongsToInterpolatedTemplate(node) })
  })
  return found
}

const classifyBlockedCandidate = (candidate: BlockedCandidate): Classified<BlockedCandidate>['verdict'] | 'unclassifiable' =>
  candidate.hasInterpolation ? 'allowed' : 'forbidden'

test('roster.renders-blockage-reason', () => {
  const thread = baseThread({ blocked_by: 'waiting on the infra approval' })
  const row = toRosterRow(thread)
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 })
  assert.ok(rendered.split('\n').some((line) => line.includes('waiting on the infra approval')))
  assert.ok(rendered.includes('Blocked: waiting on the infra approval'))

  const { program } = loadSourceProgram()
  const rosterPath = path.join(REBUILD_ROOT, 'src', 'render', 'roster.ts')
  const sourceFile = sourceFileFor(program, rosterPath)
  const candidates = collectBlockedCandidates(sourceFile)
  assert.ok(candidates.length > 0, 'expected at least one occurrence of the word blocked in roster.ts')
  assert.doesNotThrow(() => census(candidates, classifyBlockedCandidate))

  const synthetic: BlockedCandidate[] = [{ line: 1, hasInterpolation: false }]
  assert.throws(() => census(synthetic, classifyBlockedCandidate))
})

test('roster.blockage-none-when-not-blocked', () => {
  const thread = baseThread({ blocked_by: null })
  const row = toRosterRow(thread)
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 })
  assert.ok(rendered.split('\n').includes('Blockage: none'))
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
    blocked_by: '# heading blockage\nsecond line',
    next_step: '# heading next step\nsecond line'
  })
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 })

  assert.equal(rendered.includes('#'), false)
  assert.equal(/(^|\n)#{1,6}\s/.test(rendered), false)

  const expectedTitleLine = `Thread: ${escapeStored(row.title)} (${escapeStored(row.slug)})`
  const expectedBlockedLine = `Blocked: ${escapeStored(row.blocked_by ?? '')}`
  const expectedNextStepLine = `Next step: ${escapeStored(row.next_step)}`

  assert.ok(rendered.includes(expectedTitleLine))
  assert.ok(rendered.includes(expectedBlockedLine))
  assert.ok(rendered.includes(expectedNextStepLine))
})

test('roster.render-escapes-the-identifier-timestamp-and-cursor-fields', () => {
  const row = baseRow({
    id: '01ARZ\u2028TAIL',
    slug: 'identifier-fixture',
    updated_at: '2024-01-01T00:00:05.000Z\nX'
  })
  const rendered = renderRoster({ rows: [row], next_cursor: '#cursor\u2028tail', total: 2 })

  assert.ok(rendered.includes('Id: 01ARZU+2028TAIL'))
  assert.ok(rendered.includes('Updated: 2024-01-01T00:00:05.000ZU+000AX'))
  assert.ok(rendered.includes('Next cursor: U+0023cursorU+2028tail'))
  assert.equal(rendered.includes('\u2028'), false)
  assert.equal(rendered.includes('01ARZ\u2028TAIL'), false)
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
  const rendered = renderRoster({ rows: [row], next_cursor: null, total: 1 })
  const expected = [
    'Roster: 1 of 1 resumable thread.',
    [
      'Thread: Exact Output Thread (exact-output)',
      `Id: ${row.id}`,
      'Blockage: none',
      'Progress: 2/5 criteria done',
      'Next step: ship the next step',
      'Updated: 2024-01-01T00:00:05.000Z'
    ].join('\n'),
    'No further pages.'
  ].join('\n\n')
  assert.equal(rendered, expected)
})

test('roster.render-header-uses-plural-threads-when-total-is-not-one', () => {
  const zeroRows = renderRoster({ rows: [], next_cursor: null, total: 0 })
  assert.ok(zeroRows.split('\n')[0]?.includes('0 resumable threads.'))

  const row = baseRow()
  const twoTotal = renderRoster({ rows: [row], next_cursor: null, total: 2 })
  assert.ok(twoTotal.split('\n')[0]?.includes('1 of 2 resumable threads.'))
})

test('roster.render-empty-page-joins-header-and-footer-with-a-single-newline', () => {
  const rendered = renderRoster({ rows: [], next_cursor: null, total: 0 })
  assert.equal(rendered, 'Roster: 0 of 0 resumable threads.\nNo further pages.')
})

test('roster.render-separates-multiple-rows-with-a-blank-line', () => {
  const rowOne = baseRow({ id: rt.ulid(), slug: 'row-one' })
  const rowTwo = baseRow({ id: rt.ulid(), slug: 'row-two' })
  const rendered = renderRoster({ rows: [rowOne, rowTwo], next_cursor: 'a-cursor', total: 2 })
  const segments = rendered.split('\n\n')
  assert.equal(segments.length, 4)
  assert.equal(segments[segments.length - 1], 'Next cursor: a-cursor')
})
