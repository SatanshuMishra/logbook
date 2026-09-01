import type { SessionEntry } from '../schema/session.ts'

export const RESERVED_ACTOR_PREFIX = 'logbook:'

export const PARK_THREAD_ACTOR = `${RESERVED_ACTOR_PREFIX}park_thread`

const byIdAscending = (left: SessionEntry, right: SessionEntry): number => {
  if (left.id < right.id) return -1
  return left.id > right.id ? 1 : 0
}

export const previousSessionEntries = (entries: readonly SessionEntry[]): SessionEntry[] => {
  const ordered = [...entries].sort(byIdAscending)
  const boundary = ordered
    .slice(0, Math.max(0, ordered.length - 1))
    .reduce((found, entry, index) => (entry.actor === PARK_THREAD_ACTOR ? index + 1 : found), 0)
  return ordered.slice(boundary).reverse()
}
