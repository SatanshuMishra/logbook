import type { Thread, Ulid, Iso8601 } from '../schema/thread.ts'
import { escapeStored } from './escape.ts'

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

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? 'Blockage: none' : `Blocked: ${escapeStored(blockedBy)}`

const renderRosterRow = (row: RosterRow): string =>
  [
    `Thread: ${escapeStored(row.title)} (${escapeStored(row.slug)})`,
    `Id: ${escapeStored(row.id)}`,
    renderBlockage(row.blocked_by),
    `Progress: ${row.criteria_done}/${row.criteria_total} criteria done`,
    `Next step: ${escapeStored(row.next_step)}`,
    `Updated: ${escapeStored(row.updated_at)}`
  ].join('\n')

export const renderRoster = (page: RosterPage): string => {
  const header = `Roster: ${page.rows.length} of ${page.total} resumable thread${page.total === 1 ? '' : 's'}.`
  const footer = page.next_cursor === null ? 'No further pages.' : `Next cursor: ${escapeStored(page.next_cursor)}`

  if (page.rows.length === 0) {
    return [header, footer].join('\n')
  }

  const rowBlocks = page.rows.map(renderRosterRow)
  return [header, ...rowBlocks, footer].join('\n\n')
}
