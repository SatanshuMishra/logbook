type Unblocking = { decision?: never; continue?: never }

export type EmptyHookOutput = Record<string, never>

export type StopHookOutput = Unblocking & {
  hookSpecificOutput: { hookEventName: 'Stop'; additionalContext: string }
}

export type PostToolUseHookOutput = Unblocking & {
  hookSpecificOutput: { hookEventName: 'PostToolUse'; additionalContext: string }
}

export type SessionStartHookOutput = Unblocking & {
  hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string }
  systemMessage?: string
}

export type PreToolUseHookOutput = Unblocking & {
  hookSpecificOutput: { hookEventName: 'PreToolUse'; permissionDecision: 'allow'; permissionDecisionReason: string }
}
