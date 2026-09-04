import type { Thread, Ulid, Iso8601 } from '../schema/thread.ts'
import { escapeStored } from './escape.ts'
import { clipWithMarker } from './clip.ts'
import { ISO_PATTERN } from '../schema/ids.ts'

export type RosterRow = {
  id: Ulid
  slug: string
  title: string
  blocked_by: string | null
  criteria_done: number
  criteria_total: number
  next_step: string
  updated_at: Iso8601
}

export type RosterPage = { rows: RosterRow[]; next_cursor: string | null; total: number }

export type PaginateResult = { ok: true; page: RosterPage } | { ok: false; reason: 'unknown-cursor' }

const TERMINAL_STATUSES = new Set<Thread['status']>(['done', 'abandoned'])

export const ROSTER_BLOCKED_BY_CLIP_GRAPHEMES = 60

export const selectRosterThreads = (threads: Thread[]): Thread[] =>
  threads
    .filter((thread) => !TERMINAL_STATUSES.has(thread.status))
    .sort((a, b) => {
      if (a.updated_at > b.updated_at) return -1
      if (a.updated_at < b.updated_at) return 1
      return 0
    })

export const toRosterRow = (thread: Thread): RosterRow => {
  const unstruck = thread.completion_criteria.filter((criterion) => criterion.struck_by === null)
  return {
    id: thread.id,
    slug: thread.slug,
    title: thread.title,
    blocked_by: thread.blocked_by,
    criteria_done: unstruck.filter((criterion) => criterion.done).length,
    criteria_total: unstruck.length,
    next_step: thread.spine.next_step,
    updated_at: thread.updated_at
  }
}

export const paginateRoster = (rows: RosterRow[], cursor: string | null, limit: number): PaginateResult => {
  const total = rows.length

  let startIndex = 0
  if (cursor !== null) {
    const cursorIndex = rows.findIndex((row) => row.id === cursor)
    if (cursorIndex === -1) return { ok: false, reason: 'unknown-cursor' }
    startIndex = cursorIndex + 1
  }

  const page = rows.slice(startIndex, startIndex + limit)
  const hasMore = startIndex + page.length < total
  const lastRow = page[page.length - 1]
  const nextCursor = hasMore && lastRow !== undefined ? lastRow.id : null

  return { ok: true, page: { rows: page, next_cursor: nextCursor, total } }
}

const ROSTER_TABLE_HEADER = '| # | Thread ID | Thread Name | Progress | Last Activity |'
const ROSTER_TABLE_SEPARATOR = '| --- | --- | --- | --- | --- |'
const ISO_DATE_TIME_SEPARATOR = 'T'
const LAST_ACTIVITY_SECONDS_PATTERN = /:\d{2}\.\d{3}Z$/
const LAST_ACTIVITY_SUFFIX = ' UTC'

const formatLastActivity = (updatedAt: Iso8601): string => {
  if (!ISO_PATTERN.test(updatedAt)) return updatedAt
  return updatedAt.replace(ISO_DATE_TIME_SEPARATOR, ' ').replace(LAST_ACTIVITY_SECONDS_PATTERN, LAST_ACTIVITY_SUFFIX)
}

const renderBlockedBySuffix = (blockedBy: string | null): string =>
  blockedBy === null
    ? ''
    : ` (blocked by ${clipWithMarker(escapeStored(blockedBy), ROSTER_BLOCKED_BY_CLIP_GRAPHEMES)})`

const renderThreadNameCell = (row: RosterRow): string =>
  `${escapeStored(row.slug)} - ${escapeStored(row.title)}${renderBlockedBySuffix(row.blocked_by)}`

const renderRosterRow = (row: RosterRow, index: number): string =>
  `| ${index + 1} | ${escapeStored(row.id)} | ${renderThreadNameCell(row)} | ${row.criteria_done} / ${row.criteria_total} criteria | ${escapeStored(formatLastActivity(row.updated_at))} |`

const renderExcludedLine = (excludedByRelevance: number): string =>
  `Excluded: ${excludedByRelevance} terminal thread${excludedByRelevance === 1 ? '' : 's'} not shown; read ${
    excludedByRelevance === 1 ? 'it' : 'one'
  } at logbook://thread/{id}.`

export const renderRoster = (page: RosterPage, excludedByRelevance: number): string => {
  const header = `Roster: ${page.rows.length} of ${page.total} resumable thread${page.total === 1 ? '' : 's'}.`
  const excludedLines = [excludedByRelevance].filter((count) => count > 0).map(renderExcludedLine)
  const headerBlock = [header, ...excludedLines].join('\n')
  const footer = page.next_cursor === null ? 'No further pages.' : `Next cursor: ${escapeStored(page.next_cursor)}`

  if (page.rows.length === 0) {
    return [headerBlock, footer].join('\n')
  }

  const tableLines = [ROSTER_TABLE_HEADER, ROSTER_TABLE_SEPARATOR, ...page.rows.map(renderRosterRow)]
  return [headerBlock, tableLines.join('\n'), footer].join('\n\n')
}
