import { readFileSync } from 'node:fs'

type TranscriptEntry = Record<string, unknown>

const readEntriesIfPresent = (transcriptPath: string): TranscriptEntry[] | null => {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const entries: TranscriptEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        entries.push(parsed as TranscriptEntry)
      }
    } catch {
      continue
    }
  }
  return entries
}

const readEntries = (transcriptPath: string): TranscriptEntry[] => readEntriesIfPresent(transcriptPath) ?? []

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

const textsFromContent = (content: unknown): string[] => {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const texts: string[] = []
  for (const part of content) {
    const record = asRecord(part)
    if (record !== null && record.type === 'text' && typeof record.text === 'string') {
      texts.push(record.text)
    }
  }
  return texts
}

const isAssistantEntry = (entry: TranscriptEntry): boolean => {
  const message = asRecord(entry.message)
  if (message === null) return false
  return entry.type === 'assistant' || message.role === 'assistant'
}

export const collectAssistantTexts = (transcriptPath: unknown): string[] => {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return []
  const texts: string[] = []
  for (const entry of readEntries(transcriptPath)) {
    if (!isAssistantEntry(entry)) continue
    const message = asRecord(entry.message)
    if (message === null) continue
    texts.push(...textsFromContent(message.content))
  }
  return texts
}

const RESUME_TOOL_NAME_PATTERN = /^mcp__(?:plugin_logbook_)?ledger__resume_thread$/

const toolUseIn = (entry: TranscriptEntry): { id: string; name: string } | null => {
  const message = asRecord(entry.message)
  const content = message === null ? undefined : message.content
  if (!Array.isArray(content)) return null
  for (const part of content) {
    const record = asRecord(part)
    if (record !== null && record.type === 'tool_use' && typeof record.name === 'string' && typeof record.id === 'string') {
      return { id: record.id, name: record.name }
    }
  }
  return null
}

const toolResultTextFor = (entry: TranscriptEntry, toolUseId: string): string | null => {
  const message = asRecord(entry.message)
  const content = message === null ? undefined : message.content
  if (!Array.isArray(content)) return null
  for (const part of content) {
    const record = asRecord(part)
    if (record === null || record.type !== 'tool_result' || record.tool_use_id !== toolUseId) continue
    if (typeof record.content === 'string') return record.content
    const nested = textsFromContent(record.content)
    if (nested.length > 0) return nested.join('')
  }
  return null
}

const extractBriefing = (resultText: string): string | null => {
  try {
    const parsed = JSON.parse(resultText)
    const record = asRecord(parsed)
    return record !== null && typeof record.briefing === 'string' ? record.briefing : null
  } catch {
    return null
  }
}

export const findLastResumeBriefing = (transcriptPath: unknown): string | null => {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return null
  let pendingToolUseId: string | null = null
  let lastBriefing: string | null = null
  for (const entry of readEntries(transcriptPath)) {
    const toolUse = toolUseIn(entry)
    if (toolUse !== null && RESUME_TOOL_NAME_PATTERN.test(toolUse.name)) {
      pendingToolUseId = toolUse.id
      continue
    }
    if (pendingToolUseId === null) continue
    const resultText = toolResultTextFor(entry, pendingToolUseId)
    if (resultText === null) continue
    const briefing = extractBriefing(resultText)
    if (briefing !== null) lastBriefing = briefing
    pendingToolUseId = null
  }
  return lastBriefing
}

const contentPartsOf = (entry: TranscriptEntry): Record<string, unknown>[] => {
  const message = asRecord(entry.message)
  const content = message === null ? undefined : message.content
  if (!Array.isArray(content)) return []
  return content.map(asRecord).filter((part): part is Record<string, unknown> => part !== null)
}

const readEntriesOrNull = (transcriptPath: string): TranscriptEntry[] | null => {
  try {
    return readEntriesIfPresent(transcriptPath)
  } catch {
    return null
  }
}

const isResumeCall = (part: Record<string, unknown>): boolean =>
  part.type === 'tool_use' &&
  typeof part.id === 'string' &&
  typeof part.name === 'string' &&
  RESUME_TOOL_NAME_PATTERN.test(part.name)

export const isPickupTurn = (transcriptPath: unknown, promptId: string | null): boolean => {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0 || promptId === null) return false
  const entries = readEntriesOrNull(transcriptPath)
  if (entries === null) return false
  const resumeCallIds = new Set(entries.flatMap(contentPartsOf).filter(isResumeCall).map((part) => part.id))
  return entries
    .filter((entry) => entry.promptId === promptId)
    .flatMap(contentPartsOf)
    .some((part) => part.type === 'tool_result' && resumeCallIds.has(part.tool_use_id) && part.is_error !== true)
}
