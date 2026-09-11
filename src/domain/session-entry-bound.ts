import { readdirSync } from 'node:fs'
import path from 'node:path'
import * as caps from '../schema/caps.ts'
import { SessionRecord, type Ulid } from '../schema/session.ts'
import { readRecordFile } from '../store/read-path.ts'
import { PARK_THREAD_ACTOR } from './session-log.ts'

const errnoCode = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return 'unknown'
}

const sessionsDirFor = (recordsDir: string, threadId: Ulid): string => path.join(recordsDir, 'sessions', threadId)

export const countUnparkedSessionEntries = (recordsDir: string, threadId: Ulid): number => {
  let names: string[]
  try {
    names = readdirSync(sessionsDirFor(recordsDir, threadId)).filter((name) => name.endsWith('.json'))
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return 0
    throw error
  }

  const orderedNewestFirst = [...names].sort().reverse()

  let count = 0
  for (const name of orderedNewestFirst) {
    if (count >= caps.SESSION_UNPARKED_ENTRIES_MAX) break
    const filePath = path.join(sessionsDirFor(recordsDir, threadId), name)
    const slot = readRecordFile(filePath, SessionRecord)
    if (slot === null) continue
    if (slot.quarantined) {
      count += 1
      continue
    }
    if (slot.record.actor === PARK_THREAD_ACTOR) break
    count += 1
  }
  return count
}
