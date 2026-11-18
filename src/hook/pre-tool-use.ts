import { addTranscript, heldBy } from '../thread/holds.ts'
import { writeMarker } from '../thread/inflight.ts'
import type { HookInput } from './input.ts'
import type { EmptyHookOutput } from './output.ts'

const MARKER_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Agent', 'Task'])

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const preToolUse = ({ event, sessionId, paths, rt }: HookInput): EmptyHookOutput => {
  const tool = text(event.tool_name)
  if (tool === null || !MARKER_TOOLS.has(tool) || text(event.agent_id) !== null) return {}
  const held = heldBy(paths, sessionId)
  if (held === null) return {}
  const transcript = text(event.transcript_path)
  if (transcript !== null) addTranscript(rt, paths, held, transcript)
  const toolUseId = text(event.tool_use_id)
  const toolInput = isRecord(event.tool_input) ? event.tool_input : {}
  if (toolUseId !== null) writeMarker(rt, paths, held, { toolUseId, tool, toolInput, session: sessionId })
  return {}
}
