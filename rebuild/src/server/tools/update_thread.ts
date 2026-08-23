import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import type { KeyDecision, Risk, Spine, Thread } from '../../schema/thread.ts'
import * as caps from '../../schema/caps.ts'
import { contributeToSpine, type SpineContribution } from '../../domain/spine.ts'
import { commitThread, loadThread, openProjectStore } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const RiskAddSchema = z
  .strictObject({
    text: z.string().min(1).max(caps.RISK_TEXT_MAX).describe('the risk text to record on the spine'),
    scope: z.string().min(1).max(caps.RISK_SCOPE_MAX).describe('the criterion or area of the thread this risk concerns'),
    refs: z
      .array(z.string().max(caps.RISK_REF_MAX).describe('one external pointer backing this risk'))
      .max(caps.RISK_REFS_MAX_ELEMENTS)
      .optional()
      .describe('external pointers backing this risk; omit or send an empty array for none')
  })
  .describe('one new risk to append to the spine')

const KeyDecisionAddSchema = z
  .strictObject({
    decision_id: ulidField('the decision record this key decision links to; must already be recorded on this project'),
    title: z.string().min(1).max(caps.KEY_DECISION_TITLE_MAX).describe('the decision title as it should render on the spine'),
    scope: z.string().min(1).max(caps.KEY_DECISION_SCOPE_MAX).describe('the criterion or area of the thread this decision resolved')
  })
  .describe('one decision to link into the spine')

const UpdateThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to update'),
  criteria_done: z
    .array(ulidField('the id of a completion criterion already present on this thread'))
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('criterion ids to mark done; an id not present on the thread is refused'),
  active_goal: z
    .string()
    .max(caps.SPINE_ACTIVE_GOAL_MAX)
    .optional()
    .describe('replaces the spine active_goal field when supplied; omit to leave it unchanged'),
  next_step: z
    .string()
    .max(caps.SPINE_NEXT_STEP_MAX)
    .optional()
    .describe('replaces the spine next_step field when supplied; omit to leave it unchanged'),
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  risks_add: z
    .array(RiskAddSchema)
    .max(caps.OPEN_RISKS_MAX_ELEMENTS)
    .optional()
    .describe('new risks to append to the spine; each one is minted a stable id'),
  risks_retire: z
    .array(ulidField('the id of an open risk currently on this thread'))
    .max(caps.OPEN_RISKS_MAX_ELEMENTS)
    .optional()
    .describe('risk ids to remove from the spine, for example ["01ARZ3NDEKTSV4RRFFQ69G5FAV"]; retiring an id already gone is not an error'),
  key_decisions_add: z
    .array(KeyDecisionAddSchema)
    .max(caps.KEY_DECISIONS_MAX_ELEMENTS)
    .optional()
    .describe('key decisions to link into the spine; each one is minted a stable id'),
  out_of_scope_add: z
    .array(z.string().min(1).max(caps.OUT_OF_SCOPE_TEXT_MAX).describe('one statement of what this thread explicitly excludes'))
    .max(caps.OUT_OF_SCOPE_MAX_ELEMENTS)
    .optional()
    .describe('out-of-scope statements to append; each one is minted a stable id')
})

const UpdateThreadOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread that was updated'),
  criteria_marked_done: z.array(z.string()).describe('ids of criteria newly marked done by this call'),
  spine_fields_updated: z
    .array(z.enum(['active_goal', 'next_step', 'last_session']))
    .describe('which scalar spine fields this call changed'),
  risks_added: z.array(z.string()).describe('ids minted for risks this call added'),
  risks_retired: z.array(z.string()).describe('ids of risks this call removed from the spine'),
  key_decisions_added: z.array(z.string()).describe('ids minted for key decisions this call linked into the spine'),
  out_of_scope_added: z.array(z.string()).describe('ids minted for out-of-scope statements this call added')
})

type UpdateThreadInput = z.infer<typeof UpdateThreadInputSchema>
type UpdateThreadOutput = z.infer<typeof UpdateThreadOutputSchema>

export const unknownCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'only criterion ids already present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_done names ids not present on this thread: ${ids.join(', ')}.`
})

export const unknownDecisionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'key_decisions_add',
  accepted: 'a decision_id that resolves to a decision record already stored on this project',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `key_decisions_add names decision ids that do not resolve to a stored decision: ${ids.join(', ')}.`
})

export const updateThreadTool: ToolSpec<UpdateThreadInput, UpdateThreadOutput> = {
  name: 'update_thread',
  title: 'Update thread',
  description:
    'Records mid-session progress on one thread: mark criteria done, refresh any of the six running-summary fields, and add or retire risks. Every argument is optional and only what is supplied is written, so a call carrying just criteria_done: ["<criterion ulid>"] changes nothing else. Risks are retired by id rather than by resubmitting the whole list, so a thread with fourteen risks costs one id to change one of them. The reply reports what changed, not what the record now holds.',
  input: UpdateThreadInputSchema,
  output: UpdateThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const criteriaDoneIds = input.criteria_done ?? []
    const unknownCriteria = criteriaDoneIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
    if (unknownCriteria.length > 0) {
      return { ok: false, refusal: unknownCriterionRefusal(unknownCriteria) }
    }
    const markedDone = criteriaDoneIds.filter((id) => {
      const existing = thread.completion_criteria.find((c) => c.id === id)
      return existing !== undefined && !existing.done
    })
    const nextCriteria = thread.completion_criteria.map((c) =>
      criteriaDoneIds.includes(c.id) ? { ...c, done: true } : c
    )

    const retireIds = input.risks_retire ?? []
    const retiredIds = retireIds.filter((id) => thread.spine.open_risks.some((r) => r.id === id))
    const survivingRisks = thread.spine.open_risks.filter((r) => !retireIds.includes(r.id))

    const newRisks: Risk[] = (input.risks_add ?? []).map((r) => ({
      id: rt.ulid(),
      scope: r.scope,
      text: r.text,
      refs: r.refs ?? []
    }))

    const newKeyDecisions: KeyDecision[] = (input.key_decisions_add ?? []).map((kd) => ({
      id: rt.ulid(),
      decision_id: kd.decision_id,
      title: kd.title,
      scope: kd.scope
    }))
    const badDecisionRefs = newKeyDecisions.filter((kd) => {
      const slot = store.readDecision(kd.decision_id)
      return slot === null || slot.quarantined
    })
    if (badDecisionRefs.length > 0) {
      return { ok: false, refusal: unknownDecisionRefusal(badDecisionRefs.map((kd) => kd.decision_id)) }
    }

    const newOutOfScope = (input.out_of_scope_add ?? []).map((text) => ({ id: rt.ulid(), text }))

    const spineContribution: SpineContribution = {
      ...(input.active_goal !== undefined ? { active_goal: input.active_goal } : {}),
      ...(input.next_step !== undefined ? { next_step: input.next_step } : {}),
      ...(input.last_session !== undefined ? { last_session: input.last_session } : {}),
      ...(newRisks.length > 0 ? { open_risks: newRisks } : {}),
      ...(newKeyDecisions.length > 0 ? { key_decisions: newKeyDecisions } : {}),
      ...(newOutOfScope.length > 0 ? { out_of_scope: newOutOfScope } : {})
    }

    const spineFieldsUpdated: ('active_goal' | 'next_step' | 'last_session')[] = [
      ...(input.active_goal !== undefined ? (['active_goal'] as const) : []),
      ...(input.next_step !== undefined ? (['next_step'] as const) : []),
      ...(input.last_session !== undefined ? (['last_session'] as const) : [])
    ]

    const nothingChanged =
      markedDone.length === 0 &&
      retiredIds.length === 0 &&
      newRisks.length === 0 &&
      newKeyDecisions.length === 0 &&
      newOutOfScope.length === 0 &&
      spineFieldsUpdated.length === 0

    if (nothingChanged) {
      return {
        ok: true,
        text: `no fields were supplied; thread ${thread.slug} is unchanged.`,
        structured: {
          thread_id: thread.id,
          criteria_marked_done: [],
          spine_fields_updated: [],
          risks_added: [],
          risks_retired: [],
          key_decisions_added: [],
          out_of_scope_added: []
        }
      }
    }

    const spineForContribution: Spine = { ...thread.spine, open_risks: survivingRisks }
    const contributed = contributeToSpine(spineForContribution, spineContribution)
    if (!contributed.ok) {
      return { ok: false, refusal: contributed }
    }

    const nextThread: Thread = {
      ...thread,
      completion_criteria: nextCriteria,
      spine: contributed.value,
      updated_at: rt.now()
    }

    const committed = commitThread(store, nextThread, `update thread ${thread.slug}`)
    if (!committed.ok) return { ok: false, refusal: committed.refusal }

    return {
      ok: true,
      text: `updated thread ${thread.slug}: ${markedDone.length} criteria marked done, ${newRisks.length} risks added, ${retiredIds.length} risks retired.`,
      structured: {
        thread_id: committed.value.id,
        criteria_marked_done: markedDone,
        spine_fields_updated: spineFieldsUpdated,
        risks_added: newRisks.map((r) => r.id),
        risks_retired: retiredIds,
        key_decisions_added: newKeyDecisions.map((kd) => kd.id),
        out_of_scope_added: newOutOfScope.map((o) => o.id)
      }
    }
  }
}
