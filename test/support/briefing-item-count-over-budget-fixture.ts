import type { Thread, Criterion } from '../../src/schema/thread.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { CRITERIA_RETENTION_MAX_ELEMENTS } from '../../src/schema/caps.ts'

const criterionAt = (rt: Runtime, ordinal: number): Criterion => ({
  id: rt.ulid(),
  ordinal,
  text: `ship item ${ordinal}`,
  done: false,
  kind: 'planned',
  struck_by: null,
  settledness: 'proposed',
  settled_by: null
})

const criteriaAtRetentionCap = (rt: Runtime): Criterion[] =>
  Array.from({ length: CRITERIA_RETENTION_MAX_ELEMENTS }, (_unused, index) => criterionAt(rt, index + 1))

export const itemCountOverBudgetThread = (rt: Runtime): Thread => ({
  id: rt.ulid(),
  slug: 'over-budget-item-count',
  title: 'a criteria list the briefing budget cannot hold at any clip level',
  status: 'open',
  blocked_by: null,
  completion_criteria: criteriaAtRetentionCap(rt),
  spine: {
    active_goal: 'breach the briefing budget through item count rather than through field length',
    next_step: 'render this thread and read withinBudget off the result',
    landed: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})
