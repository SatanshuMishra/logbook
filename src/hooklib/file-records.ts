import { closeSync, mkdirSync, openSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, layoutFor } from '../store/layout.ts'
import { openStore } from '../store/records.ts'
import { indexRecords, textNamesPath, type IndexedRecord } from '../domain/record-index.ts'
import { renderRecordFull } from '../render/briefing.ts'
import { escapeStored } from '../render/escape.ts'
import { canonicaliseExistingPrefix } from './guard.ts'

const FILE_RECORDS_DIRECTORY = 'file-records'
const FILE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MAIN_VIEWER = 'main'
const PROJECT_DIR_ENV_KEY = 'CLAUDE_PROJECT_DIR'

type FileTouch = { sessionId: string; cwd: string; filePath: string; viewer: string }
type Claim = { marker: string }

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFileTool = (event: unknown): boolean =>
  isPlainObject(event) && typeof event.tool_name === 'string' && FILE_TOOLS.has(event.tool_name)

const parseFileTouch = (raw: unknown): FileTouch | null => {
  if (!isPlainObject(raw) || !isFileTool(raw)) return null
  const input = isPlainObject(raw.tool_input) ? raw.tool_input : {}
  const sessionId = nonEmptyString(raw.session_id)
  const cwd = nonEmptyString(raw.cwd)
  const filePath = nonEmptyString(input.file_path) ?? nonEmptyString(input.notebook_path)
  if (sessionId === null || cwd === null || filePath === null) return null
  const viewer = typeof raw.agent_id === 'string' ? `agent:${raw.agent_id}` : MAIN_VIEWER
  return { sessionId, cwd, filePath, viewer }
}

const canonical = (target: string): string => {
  const resolved = canonicaliseExistingPrefix(target)
  return resolved.ok ? resolved.path : target
}

const projectRelativePath = (projectRoot: string, absolute: string): string | null => {
  const relative = path.relative(projectRoot, absolute)
  if (relative.length === 0 || path.isAbsolute(relative)) return null
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return null
  return relative.split(path.sep).join('/')
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32)

const sessionDirectory = (stateDir: string, sessionId: string): string =>
  path.join(stateDir, FILE_RECORDS_DIRECTORY, digest(sessionId))

const makeDirectory = (directory: string): boolean => {
  try {
    mkdirSync(directory)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

const openSessionDirectory = (stateDir: string, sessionId: string): string => {
  const root = path.join(stateDir, FILE_RECORDS_DIRECTORY)
  const own = sessionDirectory(stateDir, sessionId)
  mkdirSync(root, { recursive: true })
  if (makeDirectory(own)) {
    readdirSync(root)
      .filter((entry) => entry !== path.basename(own))
      .forEach((entry) => rmSync(path.join(root, entry), { recursive: true, force: true }))
  }
  return own
}

const claim = (directory: string, viewer: string, relative: string): Claim | null => {
  const marker = path.join(directory, digest(`${viewer}\n${relative}`))
  try {
    closeSync(openSync(marker, 'wx'))
    return { marker }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw error
  }
}

const release = (held: Claim): void => {
  try {
    unlinkSync(held.marker)
  } catch {
    return
  }
}

const governsFile = (record: IndexedRecord, relative: string): boolean =>
  record.live &&
  (record.kind === 'decision' || record.kind === 'risk') &&
  record.fields.some((field) => textNamesPath(field, relative))

const renderFileRecords = (relative: string, records: readonly IndexedRecord[]): string => {
  const naming = records.length === 1 ? '1 recorded record names' : `${records.length} recorded records name`
  const header = `Logbook: ${naming} ${escapeStored(relative)}, the file this call reads or changes. Check any change to it against them:`
  return [header, ...records.map(renderRecordFull)].join('\n\n')
}

const recordsNaming = (rt: Runtime, projectDir: string, relative: string): string | null => {
  const opened = openStore(rt, projectDir)
  if (!opened.ok) throw new Error(`the store did not open: ${opened.message}`)
  const records = indexRecords(opened.value).filter((record) => governsFile(record, relative))
  return records.length === 0 ? null : renderFileRecords(relative, records)
}

const firstTouchRecords = (rt: Runtime, touch: FileTouch): string | null => {
  const projectDir = nonEmptyString(rt.env[PROJECT_DIR_ENV_KEY]) ?? touch.cwd
  const layout = layoutFor(rt, projectDir)
  if (!layout.ok) return null
  const relative = projectRelativePath(
    canonical(layout.value.projectRoot),
    canonical(path.resolve(touch.cwd, touch.filePath))
  )
  if (relative === null) return null

  createStateDirectory(layout.value)
  const held = claim(openSessionDirectory(layout.value.state, touch.sessionId), touch.viewer, relative)
  if (held === null) return null
  try {
    return recordsNaming(rt, projectDir, relative)
  } catch (error) {
    release(held)
    throw error
  }
}

export const fileRecordsContext = (rt: Runtime, event: unknown): string | null => {
  try {
    const touch = parseFileTouch(event)
    return touch === null ? null : firstTouchRecords(rt, touch)
  } catch (error) {
    rt.log({
      level: 'warn',
      event: 'file-records.failed',
      message: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
