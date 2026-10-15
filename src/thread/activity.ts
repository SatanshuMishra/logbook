import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

type Entry = Record<string, unknown>
type ToolResult = { text: string; isError: boolean }

export type Activity = { lines: string[]; changed: boolean; userWrote: boolean }

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'NotebookRead',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'TodoWrite'
])

export const LOGBOOK_READ_TOOL = /^mcp__(?:plugin_logbook_)?ledger__(?:list_threads|search_ledger|resume_thread)$/

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])
const USER_TAGS: ReadonlySet<string> = new Set(['command-message', 'command-name', 'bash-input'])
const LEADING_TAG = /^<([a-z][a-z-]*)>/
const INTERRUPTION_MARK = '[Request interrupted by user'

const isPlainObject = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '')

const firstLine = (text: string): string => (text.trimStart().split('\n')[0] ?? '').trimEnd()

const blocksOf = (content: unknown): Entry[] => (Array.isArray(content) ? content.filter(isPlainObject) : [])

const textOfBlocks = (content: unknown): string =>
  blocksOf(content)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => stringOrEmpty(block.text))
    .join('\n')

const contentOf = (entry: Entry): unknown => (isPlainObject(entry.message) ? entry.message.content : undefined)

const userTextOf = (entry: Entry): string | null => {
  const content = contentOf(entry)
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  if (content.every((block) => isPlainObject(block) && block.type === 'tool_result')) return null
  return textOfBlocks(content)
}

const isHostText = (text: string): boolean => {
  const trimmed = text.trimStart()
  if (trimmed.startsWith(INTERRUPTION_MARK)) return true
  const tag = LEADING_TAG.exec(trimmed)?.[1]
  return tag !== undefined && !USER_TAGS.has(tag)
}

export const isUserWritten = (entry: unknown): boolean => {
  if (!isPlainObject(entry) || entry.type !== 'user') return false
  if (entry.isMeta === true || entry.isCompactSummary === true) return false
  const text = userTextOf(entry)
  return text !== null && !isHostText(text)
}

const editPathOf = (input: Record<string, unknown>): string =>
  stringOrEmpty(input.file_path) || stringOrEmpty(input.notebook_path)

export const toolSummary = (name: string, input: Record<string, unknown>, resultText: string | null): string => {
  if (name === 'Bash') return firstLine(stringOrEmpty(input.command))
  if (EDIT_TOOLS.has(name)) return editPathOf(input)
  if (AGENT_TOOLS.has(name)) {
    const result = resultText === null ? '' : firstLine(resultText)
    return [firstLine(stringOrEmpty(input.description)), result].filter((part) => part.length > 0).join(' - ')
  }
  if (name === 'Skill') return stringOrEmpty(input.skill)
  return ''
}

export const activityLine = (name: string, summary: string): string =>
  summary.length === 0 ? name : `${name}: ${summary}`

const realPathOrNull = (target: string): string | null => {
  try {
    return realpathSync.native(target)
  } catch {
    return null
  }
}

const isSameFile = (candidate: string, target: string): boolean => {
  if (!path.isAbsolute(candidate) || !path.isAbsolute(target)) return false
  if (path.resolve(candidate) === path.resolve(target)) return true
  const candidateReal = realPathOrNull(candidate)
  return candidateReal !== null && candidateReal === realPathOrNull(target)
}

export const isReadOnlyCall = (name: string, input: Record<string, unknown>, workingCopyPath: string): boolean => {
  if (READ_ONLY_TOOLS.has(name) || LOGBOOK_READ_TOOL.test(name)) return true
  return EDIT_TOOLS.has(name) && isSameFile(editPathOf(input), workingCopyPath)
}

const parseLine = (line: string): Entry[] => {
  if (line.trim().length === 0) return []
  try {
    const parsed: unknown = JSON.parse(line)
    return isPlainObject(parsed) ? [parsed] : []
  } catch {
    return []
  }
}

const readEntries = (transcriptPath: string): Entry[] => {
  try {
    return readFileSync(transcriptPath, 'utf8').split('\n').flatMap(parseLine)
  } catch {
    return []
  }
}

const resultTextOf = (block: Entry): string =>
  typeof block.content === 'string' ? block.content : textOfBlocks(block.content)

const toolResultsOf = (entries: readonly Entry[]): ReadonlyMap<string, ToolResult> =>
  new Map(
    entries
      .filter((entry) => entry.type === 'user')
      .flatMap((entry) => blocksOf(contentOf(entry)))
      .filter((block) => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
      .map((block): [string, ToolResult] => [
        stringOrEmpty(block.tool_use_id),
        { text: resultTextOf(block), isError: block.is_error === true }
      ])
  )

const isAfter = (entry: Entry, since: string | null): boolean => {
  if (since === null) return true
  if (typeof entry.timestamp !== 'string') return false
  return Date.parse(entry.timestamp) > Date.parse(since)
}

export const buildActivity = (input: { transcripts: string[]; since: string | null; workingCopyPath: string }): Activity => {
  const entries = input.transcripts.flatMap(readEntries)
  const results = toolResultsOf(entries)
  const lines: string[] = []
  let changed = false
  let userWrote = false
  let lastReply: string | null = null
  for (const entry of entries.filter((candidate) => isAfter(candidate, input.since))) {
    if (entry.type === 'user' && isUserWritten(entry)) {
      userWrote = true
      lines.push(`User: ${firstLine(userTextOf(entry) ?? '')}`)
      continue
    }
    if (entry.type !== 'assistant') continue
    for (const block of blocksOf(contentOf(entry))) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        lastReply = firstLine(block.text)
        continue
      }
      if (block.type !== 'tool_use' || typeof block.name !== 'string') continue
      const toolInput = isPlainObject(block.input) ? block.input : {}
      if (isReadOnlyCall(block.name, toolInput, input.workingCopyPath)) continue
      changed = true
      const result = typeof block.id === 'string' ? results.get(block.id) : undefined
      const line = activityLine(block.name, toolSummary(block.name, toolInput, result?.text ?? null))
      lines.push(result?.isError === true ? `${line} (failed)` : line)
    }
  }
  return { lines: lastReply === null ? lines : [...lines, `Last reply: ${lastReply}`], changed, userWrote }
}
