import type { ToolSpec } from '../register.ts'
import { openThreadTool } from './open_thread.ts'
import { updateThreadTool } from './update_thread.ts'
import { closeThreadTool } from './close_thread.ts'
import { amendCriteriaTool } from './amend_criteria.ts'
import { bindBranchTool } from './bind_branch.ts'

export const TOOL_SPECS: ToolSpec<never, never>[] = [
  openThreadTool,
  updateThreadTool,
  closeThreadTool,
  amendCriteriaTool,
  bindBranchTool
] as unknown as ToolSpec<never, never>[]
