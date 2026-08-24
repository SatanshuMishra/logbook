export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

export type SessionStartEvent = {
  session_id: string
  transcript_path: string
  cwd: string
  hook_event_name: 'SessionStart'
  source: SessionStartSource
}

export type SessionEndReason = 'clear' | 'resume' | 'logout' | 'prompt_input_exit' | 'other'

export type SessionEndEvent = {
  session_id: string
  transcript_path: string
  cwd: string
  prompt_id: string
  hook_event_name: 'SessionEnd'
  reason: SessionEndReason
}

export type UserPromptSubmitEvent = {
  session_id: string
  transcript_path: string
  cwd: string
  prompt_id: string
  permission_mode: string
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}

export type ToolEffort = { level: string }

export type PreToolUseEvent = {
  session_id: string
  transcript_path: string
  cwd: string
  prompt_id: string
  permission_mode: string
  effort: ToolEffort
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
}

export type PostToolUseEvent = {
  session_id: string
  transcript_path: string
  cwd: string
  prompt_id: string
  permission_mode: string
  effort: ToolEffort
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_response: Record<string, unknown>
  tool_use_id: string
  duration_ms: number
}

export type StopEvent = {
  session_id: string
  transcript_path: string
  cwd: string
  prompt_id: string
  permission_mode: string
  effort: ToolEffort
  hook_event_name: 'Stop'
  stop_hook_active: boolean
  last_assistant_message: string
  background_tasks: unknown[]
  session_crons: unknown[]
}
