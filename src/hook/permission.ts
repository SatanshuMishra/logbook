import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { EmptyHookOutput, PreToolUseHookOutput } from './output.ts'
import { THREAD_SLUG_PATTERN } from '../thread/paths.ts'

export type PermissionEvent = { tool_name: string; tool_input: Record<string, unknown> }

export type PermissionOutput = EmptyHookOutput | PreToolUseHookOutput

export const WORKING_COPY_KEY_PATTERN = /^[a-z0-9-]{0,40}-[0-9a-f]{12}$/

const PERMITTED_TOOLS: ReadonlySet<string> = new Set(['Read', 'Edit'])
const LOGBOOK_FOLDER = '.logbook'
const DOCUMENT_SUFFIX = '.md'

const allowWorkingCopy = (): PermissionOutput => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: 'logbook working copy'
  }
})

const realPathOf = (file: string): string | null => {
  try {
    return realpathSync(file)
  } catch {
    return null
  }
}

const entryExists = (file: string): boolean | null => {
  try {
    lstatSync(file)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : null
  }
}

const resolvedPath = (file: string): string | null => {
  const exists = entryExists(file)
  if (exists === null) return null
  if (exists) return realPathOf(file)
  const folder = realPathOf(path.dirname(file))
  return folder === null ? null : path.join(folder, path.basename(file))
}

const isWorkingCopyName = (name: string): boolean =>
  name.endsWith(DOCUMENT_SUFFIX) && THREAD_SLUG_PATTERN.test(name.slice(0, name.length - DOCUMENT_SUFFIX.length))

const isWorkingCopy = (resolved: string, logbookRoot: string): boolean => {
  const folder = path.dirname(resolved)
  return (
    path.dirname(folder) === logbookRoot &&
    WORKING_COPY_KEY_PATTERN.test(path.basename(folder)) &&
    isWorkingCopyName(path.basename(resolved))
  )
}

export const permissionDecision = (rt: Runtime, event: PermissionEvent): PermissionOutput => {
  if (!PERMITTED_TOOLS.has(event.tool_name)) return {}
  const file = event.tool_input.file_path
  if (typeof file !== 'string' || !path.isAbsolute(file)) return {}
  const home = rt.env.HOME
  if (home === undefined || home === '') return {}
  const realHome = realPathOf(home)
  if (realHome === null) return {}
  const resolved = resolvedPath(file)
  if (resolved === null) return {}
  return isWorkingCopy(resolved, path.join(realHome, LOGBOOK_FOLDER)) ? allowWorkingCopy() : {}
}
