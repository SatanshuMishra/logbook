import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { answerHookEvent, type HookEventFields } from '../hook/event.ts'
import type { Runtime } from '../runtime/runtime.ts'

export const HOOK_TOOL_NAME = 'hook_event'

export const HOOK_EVENT_FIELDS = [
  'hook_event_name',
  'session_id',
  'cwd',
  'transcript_path',
  'tool_name',
  'tool_input',
  'tool_response',
  'tool_use_id',
  'agent_id',
  'prompt_id',
  'stop_hook_active'
] as const satisfies readonly (keyof HookEventFields)[]

const MAX_FIELD_LENGTH = 32 * 1024 * 1024

const HOOK_TOOL_TITLE = 'Logbook hook'

const HOOK_TOOL_DESCRIPTION = "Claude Code calls this for logbook's hooks; never call it yourself."

const fieldSchema = z.string().max(MAX_FIELD_LENGTH).optional()

const HOOK_EVENT_INPUT = z.strictObject(
  Object.fromEntries(HOOK_EVENT_FIELDS.map((field) => [field, fieldSchema])) as Record<
    (typeof HOOK_EVENT_FIELDS)[number],
    typeof fieldSchema
  >
)

const failureMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const textResult = (text: string, isError: boolean): CallToolResult =>
  isError ? { isError: true, content: [{ type: 'text', text }] } : { content: [{ type: 'text', text }] }

const answer = async (rt: Runtime, fields: HookEventFields): Promise<CallToolResult> => {
  try {
    return textResult(await answerHookEvent(rt, fields), false)
  } catch (error) {
    const eventName = fields.hook_event_name ?? ''
    const message = failureMessage(error)
    rt.log({ level: 'error', event: 'hook_event.failed', hook_event_name: eventName, message })
    return textResult(`logbook hook_event ${eventName} failed: ${message}`, true)
  }
}

export const registerHookTool = (server: McpServer, rt: Runtime): void => {
  server.registerTool(
    HOOK_TOOL_NAME,
    {
      title: HOOK_TOOL_TITLE,
      description: HOOK_TOOL_DESCRIPTION,
      inputSchema: HOOK_EVENT_INPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (fields) => answer(rt, fields)
  )
}
