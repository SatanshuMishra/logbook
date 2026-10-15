export const LEDGER_TOOL_NAMES = [
  'open_thread',
  'resume_thread',
  'record_decision',
  'update_thread',
  'park_thread',
  'close_thread',
  'list_threads',
  'search_ledger',
  'sync_ledger'
] as const

export type LedgerToolName = (typeof LEDGER_TOOL_NAMES)[number]

export const isLedgerToolName = (candidate: string): candidate is LedgerToolName =>
  (LEDGER_TOOL_NAMES as readonly string[]).includes(candidate)
