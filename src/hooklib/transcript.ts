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

const RESUME_TOOL_NAME_PATTERN = /^mcp__(?:plugin_logbook_)?ledger__resume_thread$/

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

const isTranscriptPath = (transcriptPath: unknown): transcriptPath is string =>
  typeof transcriptPath === 'string' && transcriptPath.length > 0

const resultTextOf = (part: Record<string, unknown>): string =>
  typeof part.content === 'string' ? part.content : textsFromContent(part.content).join('')

export type TurnResumeResult = { position: number; text: string }

export const readTurnResumeResults = (transcriptPath: unknown, promptId: string | null): TurnResumeResult[] => {
  if (!isTranscriptPath(transcriptPath) || promptId === null) return []
  const entries = readEntriesOrNull(transcriptPath)
  if (entries === null) return []
  const resumeCallIds = new Set(entries.flatMap(contentPartsOf).filter(isResumeCall).map((part) => part.id))
  return entries.flatMap((entry, position) =>
    entry.promptId === promptId
      ? contentPartsOf(entry)
          .filter((part) => part.type === 'tool_result' && resumeCallIds.has(part.tool_use_id) && part.is_error !== true)
          .map((part) => ({ position, text: resultTextOf(part) }))
      : []
  )
}

export const isPickupTurn = (transcriptPath: unknown, promptId: string | null): boolean =>
  readTurnResumeResults(transcriptPath, promptId).length > 0

export const assistantTextsAfter = (transcriptPath: unknown, position: number): string[] | null => {
  if (!isTranscriptPath(transcriptPath)) return null
  const entries = readEntriesOrNull(transcriptPath)
  if (entries === null) return null
  return entries
    .slice(position + 1)
    .filter(isAssistantEntry)
    .flatMap((entry) => textsFromContent(asRecord(entry.message)?.content))
}
