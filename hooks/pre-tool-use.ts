#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { permissionDecision } from '../src/hook/permission.ts'
import { addTranscript, heldBy } from '../src/thread/holds.ts'
import { writeMarker } from '../src/thread/inflight.ts'

const PERMISSION_TOOLS: ReadonlySet<string> = new Set(['Read', 'Edit'])
const MARKER_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Agent', 'Task'])

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

await runHook('pre-tool-use', ({ event, sessionId, paths, rt }) => {
  const tool = text(event.tool_name)
  if (tool === null) return {}
  const toolInput = isRecord(event.tool_input) ? event.tool_input : {}
  if (PERMISSION_TOOLS.has(tool)) return permissionDecision(rt, { tool_name: tool, tool_input: toolInput })
  if (!MARKER_TOOLS.has(tool) || text(event.agent_id) !== null) return {}
  const held = heldBy(paths, sessionId)
  if (held === null) return {}
  const transcript = text(event.transcript_path)
  if (transcript !== null) addTranscript(rt, paths, held, transcript)
  const toolUseId = text(event.tool_use_id)
  if (toolUseId !== null) writeMarker(rt, paths, held, { toolUseId, tool, toolInput, session: sessionId })
  return {}
})
