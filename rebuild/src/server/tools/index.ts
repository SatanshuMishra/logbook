import type { ToolSpec } from '../register.ts'
import { openThreadTool } from './open_thread.ts'
import { updateThreadTool } from './update_thread.ts'
import { closeThreadTool } from './close_thread.ts'
import { amendCriteriaTool } from './amend_criteria.ts'
import { bindBranchTool } from './bind_branch.ts'
import { resumeThreadTool } from './resume_thread.ts'
import { parkThreadTool } from './park_thread.ts'

export const TOOL_SPECS: ToolSpec<never, never>[] = [
  openThreadTool,
  updateThreadTool,
  closeThreadTool,
  amendCriteriaTool,
  bindBranchTool,
  resumeThreadTool,
  parkThreadTool
] as unknown as ToolSpec<never, never>[]
