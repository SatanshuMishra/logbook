import type { Thread } from '../../src/schema/thread.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import * as caps from '../../src/schema/caps.ts'

const ESCAPE_EXPANDING_CODE_POINT = 0x01
const ESCAPE_EXPANDING_CHAR = String.fromCodePoint(ESCAPE_EXPANDING_CODE_POINT)

const escapeExpandingFill = (length: number): string => ESCAPE_EXPANDING_CHAR.repeat(length)

export const overBudgetThread = (rt: Runtime): Thread => ({
  id: rt.ulid(),
  slug: 'over-budget-header-fields',
  title: escapeExpandingFill(caps.THREAD_TITLE_MAX),
  status: 'open',
  blocked_by: escapeExpandingFill(caps.THREAD_BLOCKED_BY_MAX),
  completion_criteria: [
    {
      id: rt.ulid(),
      ordinal: 1,
      text: 'the renderer reports that this record does not fit the resume payload budget',
      done: false,
      kind: 'planned',
      struck_by: null
    }
  ],
  spine: {
    active_goal: escapeExpandingFill(caps.SPINE_ACTIVE_GOAL_MAX),
    next_step: escapeExpandingFill(caps.SPINE_NEXT_STEP_MAX),
    last_session: escapeExpandingFill(caps.SPINE_LAST_SESSION_MAX),
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})
