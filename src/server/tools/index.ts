import type { ToolSpec } from '../register.ts'
import { LEDGER_TOOL_NAMES, type LedgerToolName } from '../tool-names.ts'
import { openThreadTool } from './open_thread.ts'
import { resumeThreadTool } from './resume_thread.ts'
import { recordDecisionTool } from './record_decision.ts'
import { updateThreadTool } from './update_thread.ts'
import { parkThreadTool } from './park_thread.ts'
import { closeThreadTool } from './close_thread.ts'
import { listThreadsTool } from './list_threads.ts'
import { searchLedgerTool } from './search_ledger.ts'
import { syncLedgerTool } from './sync_ledger.ts'

const SPEC_BY_NAME = {
  open_thread: openThreadTool,
  resume_thread: resumeThreadTool,
  record_decision: recordDecisionTool,
  update_thread: updateThreadTool,
  park_thread: parkThreadTool,
  close_thread: closeThreadTool,
  list_threads: listThreadsTool,
  search_ledger: searchLedgerTool,
  sync_ledger: syncLedgerTool
} satisfies Record<LedgerToolName, { name: string }>

export const TOOL_SPECS: ToolSpec<never, never>[] = LEDGER_TOOL_NAMES.map(
  (name) => SPEC_BY_NAME[name]
) as unknown as ToolSpec<never, never>[]
