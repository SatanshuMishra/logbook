import type { Runtime } from '../runtime/runtime.ts'
import { hookInputFor, type HookInput } from './input.ts'
import type { EmptyHookOutput, PostToolUseHookOutput, StopHookOutput } from './output.ts'
import { postToolUse } from './post-tool-use.ts'
import { preToolUse } from './pre-tool-use.ts'
import { stop } from './stop.ts'

export type HookEventFields = {
  hook_event_name?: string | undefined
  session_id?: string | undefined
  cwd?: string | undefined
  transcript_path?: string | undefined
  tool_name?: string | undefined
  tool_input?: string | undefined
  tool_response?: string | undefined
  tool_use_id?: string | undefined
  agent_id?: string | undefined
  prompt_id?: string | undefined
  stop_hook_active?: string | undefined
}

type HookEventOutput = EmptyHookOutput | PostToolUseHookOutput | StopHookOutput

const OBJECT_FIELDS: ReadonlySet<string> = new Set(['tool_input', 'tool_response'])
const STOP_ACTIVE_FIELD = 'stop_hook_active'
const TRUE_TEXT = 'true'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonObjectOf = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const eventEntry = (key: string, text: string): [string, unknown] | null => {
  if (key === STOP_ACTIVE_FIELD) return [key, text === TRUE_TEXT]
  if (!OBJECT_FIELDS.has(key)) return [key, text]
  const parsed = jsonObjectOf(text)
  return parsed === null ? null : [key, parsed]
}

const eventOf = (fields: HookEventFields): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
      .map(([key, text]) => eventEntry(key, text))
      .filter((entry): entry is [string, unknown] => entry !== null)
  )

const dispatch = (name: string | undefined, input: HookInput): HookEventOutput => {
  switch (name) {
    case 'PreToolUse':
      return preToolUse(input)
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return postToolUse(input)
    case 'Stop':
      return stop(input)
    default:
      return {}
  }
}

export const answerHookEvent = async (rt: Runtime, fields: HookEventFields): Promise<string> => {
  const input = hookInputFor(rt, eventOf(fields))
  return JSON.stringify(input === null ? {} : dispatch(fields.hook_event_name, input))
}
