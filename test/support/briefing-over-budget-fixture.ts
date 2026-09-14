import type { Thread } from '../../src/schema/thread.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'

const FORMER_THREAD_TITLE_MAX = 200
const FORMER_HEADER_TEXT_MAX = 500

const ESCAPE_EXPANDING_CODE_POINT = 0x01
const ESCAPE_EXPANDING_CHAR = String.fromCodePoint(ESCAPE_EXPANDING_CODE_POINT)

const escapeExpandingFill = (length: number): string => ESCAPE_EXPANDING_CHAR.repeat(length)

export const overBudgetThread = (rt: Runtime): Thread => ({
  id: rt.ulid(),
  slug: 'over-budget-header-fields',
  title: escapeExpandingFill(FORMER_THREAD_TITLE_MAX),
  status: 'open',
  blocked_by: escapeExpandingFill(FORMER_HEADER_TEXT_MAX),
  completion_criteria: [
    {
      id: rt.ulid(),
      ordinal: 1,
      text: 'the renderer reports that this record does not fit the resume payload budget',
      done: false,
      kind: 'planned',
      struck_by: null,
      settledness: 'proposed',
      settled_by: null
    }
  ],
  spine: {
    active_goal: escapeExpandingFill(FORMER_HEADER_TEXT_MAX),
    next_step: escapeExpandingFill(FORMER_HEADER_TEXT_MAX),
    landed: escapeExpandingFill(FORMER_HEADER_TEXT_MAX),
    last_session: escapeExpandingFill(FORMER_HEADER_TEXT_MAX),
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})
