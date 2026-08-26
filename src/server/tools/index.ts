import type { ToolSpec } from '../register.ts'
import { LEDGER_TOOL_NAMES, type LedgerToolName } from '../tool-names.ts'
import { openThreadTool } from './open_thread.ts'
import { updateThreadTool } from './update_thread.ts'
import { closeThreadTool } from './close_thread.ts'
import { amendCriteriaTool } from './amend_criteria.ts'
import { bindBranchTool } from './bind_branch.ts'
import { resumeThreadTool } from './resume_thread.ts'
import { parkThreadTool } from './park_thread.ts'
import { recordDecisionTool } from './record_decision.ts'
import { logSessionEventTool } from './log_session_event.ts'
import { syncLedgerTool } from './sync_ledger.ts'
import { resolveConflictTool } from './resolve_conflict.ts'
import { listThreadsTool } from './list_threads.ts'

const SPEC_BY_NAME = {
  open_thread: openThreadTool,
  update_thread: updateThreadTool,
  close_thread: closeThreadTool,
  amend_criteria: amendCriteriaTool,
  bind_branch: bindBranchTool,
  resume_thread: resumeThreadTool,
  park_thread: parkThreadTool,
  record_decision: recordDecisionTool,
  log_session_event: logSessionEventTool,
  sync_ledger: syncLedgerTool,
  resolve_conflict: resolveConflictTool,
  list_threads: listThreadsTool
} satisfies Record<LedgerToolName, { name: string }>

export const TOOL_SPECS: ToolSpec<never, never>[] = LEDGER_TOOL_NAMES.map(
  (name) => SPEC_BY_NAME[name]
) as unknown as ToolSpec<never, never>[]
