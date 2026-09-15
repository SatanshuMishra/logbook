import { readdirSync } from 'node:fs'
import path from 'node:path'
import * as caps from '../schema/caps.ts'
import { ULID_PATTERN } from '../schema/ids.ts'
import { SessionRecord, type Ulid } from '../schema/session.ts'
import { errnoCode } from '../store/detail.ts'
import { readRecordFile } from '../store/read-path.ts'
import { PARK_THREAD_ACTOR } from './session-log.ts'

const JSON_EXTENSION = '.json'

const sessionsDirFor = (recordsDir: string, threadId: Ulid): string => path.join(recordsDir, 'sessions', threadId)

const stemOf = (fileName: string): string => fileName.slice(0, -JSON_EXTENSION.length)

export const unparkedSessionEntriesSaturateBound = (recordsDir: string, threadId: Ulid): boolean => {
  let entries: string[]
  try {
    entries = readdirSync(sessionsDirFor(recordsDir, threadId), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_EXTENSION))
      .map((entry) => entry.name)
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false
    throw error
  }

  const orderedNewestFirst = entries.filter((name) => ULID_PATTERN.test(stemOf(name))).sort().reverse()

  let count = 0
  let scanned = 0
  for (const name of orderedNewestFirst) {
    if (scanned >= caps.SESSION_UNPARKED_ENTRIES_MAX) break
    scanned += 1
    const filePath = path.join(sessionsDirFor(recordsDir, threadId), name)
    const slot = readRecordFile(filePath, SessionRecord)
    if (slot === null) continue
    if (slot.quarantined) {
      count += 1
      continue
    }
    if (slot.record.actor === PARK_THREAD_ACTOR) return false
    count += 1
  }
  return count >= caps.SESSION_UNPARKED_ENTRIES_MAX
}
