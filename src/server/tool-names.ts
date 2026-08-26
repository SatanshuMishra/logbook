export const LEDGER_TOOL_NAMES = [
  'open_thread',
  'update_thread',
  'close_thread',
  'amend_criteria',
  'bind_branch',
  'resume_thread',
  'park_thread',
  'record_decision',
  'log_session_event',
  'sync_ledger',
  'resolve_conflict',
  'list_threads'
] as const

export type LedgerToolName = (typeof LEDGER_TOOL_NAMES)[number]

export const isLedgerToolName = (candidate: string): candidate is LedgerToolName =>
  (LEDGER_TOOL_NAMES as readonly string[]).includes(candidate)
