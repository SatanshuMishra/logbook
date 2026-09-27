import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { openStore } from '../store/records.ts'
import { indexRecords, type IndexedRecord } from '../domain/record-index.ts'
import { renderRecordFull } from '../render/briefing.ts'
import { escapeStored } from '../render/escape.ts'

const FILE_RECORDS_FILE_NAME = 'file-records.json'
const FILE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MAIN_VIEWER = 'main'

type ShownPaths = Record<string, string[]>
type FileRecordsState = { session_id: string; shown: ShownPaths }
type FileTouch = { sessionId: string; cwd: string; filePath: string; viewer: string }

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseFileTouch = (raw: unknown): FileTouch | null => {
  if (!isPlainObject(raw)) return null
  if (typeof raw.tool_name !== 'string' || !FILE_TOOLS.has(raw.tool_name)) return null
  const input = isPlainObject(raw.tool_input) ? raw.tool_input : {}
  const sessionId = nonEmptyString(raw.session_id)
  const cwd = nonEmptyString(raw.cwd)
  const filePath = nonEmptyString(input.file_path) ?? nonEmptyString(input.notebook_path)
  if (sessionId === null || cwd === null || filePath === null) return null
  const viewer = typeof raw.agent_id === 'string' ? `agent:${raw.agent_id}` : MAIN_VIEWER
  return { sessionId, cwd, filePath, viewer }
}

const canonicalFilePath = (cwd: string, filePath: string): string => {
  const absolute = path.resolve(cwd, filePath)
  try {
    return path.join(realpathSync.native(path.dirname(absolute)), path.basename(absolute))
  } catch {
    return absolute
  }
}

const projectRelativePath = (projectRoot: string, absolute: string): string | null => {
  const relative = path.relative(projectRoot, absolute)
  if (relative.length === 0 || path.isAbsolute(relative)) return null
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return null
  return relative.split(path.sep).join('/')
}

const statePathFor = (stateDir: string): string => path.join(stateDir, FILE_RECORDS_FILE_NAME)

const isShownPaths = (value: unknown): value is ShownPaths =>
  isPlainObject(value) &&
  Object.values(value).every((paths) => Array.isArray(paths) && paths.every((entry) => typeof entry === 'string'))

const readState = (stateDir: string): FileRecordsState | null => {
  let raw: string
  try {
    raw = readFileSync(statePathFor(stateDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed) || typeof parsed.session_id !== 'string' || !isShownPaths(parsed.shown)) return null
  return { session_id: parsed.session_id, shown: parsed.shown }
}

const governsFile = (record: IndexedRecord, relative: string): boolean =>
  record.live &&
  (record.kind === 'decision' || record.kind === 'risk') &&
  record.fields.some((field) => field.includes(relative))

const renderFileRecords = (relative: string, records: readonly IndexedRecord[]): string => {
  const naming = records.length === 1 ? '1 recorded record names' : `${records.length} recorded records name`
  const header = `Logbook: ${naming} ${escapeStored(relative)}, the file this call reads or changes. Check any change to it against them:`
  return [header, ...records.map(renderRecordFull)].join('\n\n')
}

const firstTouchRecords = (rt: Runtime, touch: FileTouch): string | null => {
  const layout = layoutFor(rt, touch.cwd)
  if (!layout.ok) return null
  const relative = projectRelativePath(layout.value.projectRoot, canonicalFilePath(touch.cwd, touch.filePath))
  if (relative === null) return null

  const previous = readState(layout.value.state)
  const shown = previous !== null && previous.session_id === touch.sessionId ? previous.shown : {}
  const viewerPaths = shown[touch.viewer] ?? []
  if (viewerPaths.includes(relative)) return null

  const next: FileRecordsState = { session_id: touch.sessionId, shown: { ...shown, [touch.viewer]: [...viewerPaths, relative] } }
  createStateDirectory(layout.value)
  durableWrite(statePathFor(layout.value.state), JSON.stringify(next), { log: rt.log })

  const opened = openStore(rt, touch.cwd)
  if (!opened.ok) return null
  const records = indexRecords(opened.value).filter((record) => governsFile(record, relative))
  return records.length === 0 ? null : renderFileRecords(relative, records)
}

export const fileRecordsContext = (rt: Runtime, event: unknown): string | null => {
  try {
    const touch = parseFileTouch(event)
    return touch === null ? null : firstTouchRecords(rt, touch)
  } catch {
    return null
  }
}
