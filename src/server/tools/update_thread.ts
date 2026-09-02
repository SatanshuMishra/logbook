import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import type { KeyDecision, Risk, Spine, Thread, Ulid } from '../../schema/thread.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { contributeToSpine, type SpineContribution } from '../../domain/spine.ts'
import { layoutFor, type StoreLayout } from '../../store/layout.ts'
import { readPointer, writePointer, type Pointer, type PointerRead } from '../../domain/pointer.ts'
import { commitThread, loadThread, openProjectStore, type Attempt } from '../tool-support.ts'
import { errnoCode } from '../../store/detail.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)
const optionalUlidField = (description: string) => z.string().regex(ULID_PATTERN).optional().describe(description)

const RiskAddSchema = z
  .strictObject({
    text: z.string().min(1).max(caps.RISK_TEXT_MAX).describe('the risk text to record on the spine'),
    scope: z.string().min(1).max(caps.RISK_SCOPE_MAX).describe('the criterion or area of the thread this risk concerns'),
    refs: z
      .array(z.string().regex(/\S/).max(caps.RISK_REF_MAX).describe('one external pointer backing this risk'))
      .max(caps.RISK_REFS_MAX_ELEMENTS)
      .optional()
      .describe('external pointers backing this risk; omit or send an empty array for none'),
    criterion_id: optionalUlidField(
      'the completion criterion this risk ranks against; refused when it names no criterion on this thread'
    )
  })
  .describe('one new risk to append to the spine')

const KeyDecisionAddSchema = z
  .strictObject({
    decision_id: ulidField('the decision record this key decision links to; must already be recorded on this project'),
    title: z.string().min(1).max(caps.KEY_DECISION_TITLE_MAX).describe('the decision title as it should render on the spine'),
    scope: z.string().min(1).max(caps.KEY_DECISION_SCOPE_MAX).describe('the criterion or area of the thread this decision resolved')
  })
  .describe('one decision to link into the spine')

const CriterionDoneSchema = z
  .strictObject({
    criterion_id: ulidField('the id of a completion criterion already present on this thread'),
    result: z
      .string()
      .max(caps.CRITERION_RESULT_MAX)
      .describe('what the check returned, or when it could not be run, specifically why it could not'),
    result_status: z
      .enum(['verified', 'unverified-reasoned'])
      .describe('verified when the check was run and result is what it returned; unverified-reasoned when the check could not be run and result says why')
  })
  .describe('one criterion to mark done, as an object carrying what was observed; the bare criterion id string this argument took before is refused, so send {"criterion_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "result": "436 tests, 0 fail, exit 0", "result_status": "verified"} in place of "01ARZ3NDEKTSV4RRFFQ69G5FAV"')

const UpdateThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to update'),
  criteria_done: z
    .array(CriterionDoneSchema)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('criteria to mark done, each carrying what was observed; an id not present on the thread is refused'),
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
  blocked_by: z
    .string()
    .min(1)
    .max(caps.THREAD_BLOCKED_BY_MAX)
    .optional()
    .describe('what this thread is blocked on; omit to leave it unchanged, and send blocked_by_clear to clear it'),
  blocked_by_clear: z
    .boolean()
    .optional()
    .describe('send true to clear what this thread is blocked on; omit to leave it unchanged'),
  risks_add: z
    .array(RiskAddSchema)
    .max(caps.RISKS_PER_CALL_MAX_ELEMENTS)
    .optional()
    .describe('new risks to append to the spine; each one is minted a stable id'),
  risks_retire: z
    .array(ulidField('the id of an open risk currently on this thread'))
    .max(caps.RISKS_PER_CALL_MAX_ELEMENTS)
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
    .describe('out-of-scope statements to append; each one is minted a stable id'),
  focus: z
    .array(ulidField('a completion criterion this session is focused on; refused when it names no criterion on this thread'))
    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
    .optional()
    .describe(
      'which completion criteria this session is focused on, written to this session\'s pointer only, never to the thread record; omit to leave it unchanged'
    )
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
  out_of_scope_added: z.array(z.string()).describe('ids minted for out-of-scope statements this call added'),
  blocked_by_set: z.boolean().describe('whether this call changed what the thread is blocked on, by either setting or clearing it'),
  focus_written: z.boolean().describe('whether this call wrote focus to this session\'s pointer'),
  focus_not_written_reason: z
    .string()
    .nullable()
    .describe('why focus was not written to this session\'s pointer, or null when it was written or focus was not supplied')
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

const duplicateCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'at most one entry per criterion id in a single call',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_done names the same criterion more than once, so no single result could be stored for it: ${ids.join(', ')}.`
})

const emptyResultRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'a non-empty result on every entry, stating what the check returned or why it could not be run',
  example: '436 tests, 0 fail, exit 0',
  retryable: true,
  message: `criteria_done carries an empty result for these criteria, and a criterion is never marked done without one: ${ids.join(', ')}.`
})

const resultCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: `at most ${caps.CRITERION_RESULT_MAX} characters after escaping, per result`,
  example: '436 tests, 0 fail, exit 0',
  retryable: true,
  message: `criteria_done[${index}].result exceeds its cap of ${caps.CRITERION_RESULT_MAX} characters after escaping; observed ${observed}; remedy: shorten the result, record the detail through log_session_event, and retry.`
})

const contradictoryResultRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'a criterion that is not already done, or the same result and result_status it was already marked done with',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `criteria_done would overwrite the recorded result of a criterion already marked done, and a recorded result is never rewritten: ${ids.join(', ')}.`
})

const struckCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'only un-struck criterion ids present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_done names criteria that have already been struck and cannot be marked done: ${ids.join(', ')}.`
})

export const conflictingBlockageRefusal = (): Refusal => ({
  ok: false,
  field: 'blocked_by',
  accepted: 'either blocked_by to say what the thread is blocked on, or blocked_by_clear to clear it, never both in one call',
  example: 'waiting on the infra approval',
  retryable: true,
  message: 'blocked_by and blocked_by_clear were both supplied; send one or the other, not both.'
})

export const blockedByCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'blocked_by',
  accepted: `at most ${caps.THREAD_BLOCKED_BY_MAX} characters after escaping`,
  example: 'waiting on the infra approval',
  retryable: true,
  message: `blocked_by exceeds its cap of ${caps.THREAD_BLOCKED_BY_MAX} characters after escaping; observed ${observed}; remedy: shorten the blocked_by text and retry.`
})

export const unknownDecisionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'key_decisions_add',
  accepted: 'a decision_id that resolves to a decision record already stored on this project',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `key_decisions_add names decision ids that do not resolve to a stored decision: ${ids.join(', ')}.`
})

const danglingRiskCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'risks_add',
  accepted: 'a criterion_id that names a completion criterion already present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `risks_add names criterion ids not present on this thread: ${ids.join(', ')}.`
})

export const unknownFocusRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'focus',
  accepted: 'a criterion_id that names a completion criterion already present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `focus names ids not present on this thread: ${ids.join(', ')}.`
})

const duplicateFocusRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'focus',
  accepted: 'at most one entry per criterion id in a single call',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `focus names the same criterion more than once: ${ids.join(', ')}.`
})

type FocusOutcome = { written: boolean; reason: string | null }

export const NO_WORKED_THREAD_FOCUS_REASON =
  'no thread is marked as being worked on this machine, so there was no session focus to set'
export const DIFFERENT_THREAD_FOCUS_REASON =
  "the thread marked as being worked is a different thread, so this thread's focus was not set"
export const OTHER_SESSION_FOCUS_REASON =
  'another session holds the record of what is being worked, so this session did not overwrite its focus'
export const UNREADABLE_POINTER_FOCUS_REASON =
  "the record of what is being worked could not be read, so this session's focus was not set"

type FocusPlan = { outcome: FocusOutcome; pending: { layout: StoreLayout; next: Pointer } | null }

const decideFocusOutcome = (rt: Runtime, threadId: string, focusIds: Ulid[] | undefined): Attempt<FocusPlan> => {
  if (focusIds === undefined) return { ok: true, value: { outcome: { written: false, reason: null }, pending: null } }

  const layout = layoutFor(rt, rt.cwd)
  if (!layout.ok) return { ok: false, refusal: layout }

  let pointerRead: PointerRead
  try {
    pointerRead = readPointer(rt, layout.value)
  } catch (error) {
    rt.log({ level: 'error', event: 'focus.pointer-unreadable', code: errnoCode(error), detail: (error as Error).message })
    return { ok: true, value: { outcome: { written: false, reason: UNREADABLE_POINTER_FOCUS_REASON }, pending: null } }
  }
  if (pointerRead.kind !== 'pointer') {
    return { ok: true, value: { outcome: { written: false, reason: NO_WORKED_THREAD_FOCUS_REASON }, pending: null } }
  }
  if (pointerRead.value.thread_id !== threadId) {
    return { ok: true, value: { outcome: { written: false, reason: DIFFERENT_THREAD_FOCUS_REASON }, pending: null } }
  }
  if (pointerRead.value.session_id !== rt.sessionId) {
    return { ok: true, value: { outcome: { written: false, reason: OTHER_SESSION_FOCUS_REASON }, pending: null } }
  }

  return {
    ok: true,
    value: {
      outcome: { written: true, reason: null },
      pending: { layout: layout.value, next: { ...pointerRead.value, focus: focusIds } }
    }
  }
}

const applyFocusPlan = (rt: Runtime, plan: FocusPlan): void => {
  if (plan.pending !== null) writePointer(rt, plan.pending.layout, plan.pending.next)
}

export const updateThreadTool: ToolSpec<UpdateThreadInput, UpdateThreadOutput> = {
  name: 'update_thread',
  title: 'Update thread',
  description:
    'Records mid-session progress on one thread: mark criteria done, refresh any of the six running-summary fields, set or clear what the thread is blocked on, and add or retire risks. Every argument is optional and only what is supplied is written, so a call carrying just criteria_done: [{"criterion_id": "<criterion ulid>", "result": "<what the check returned>", "result_status": "verified"}] changes nothing else. Marking a criterion done records what was observed and whether the check was actually run, and it is refused without both. Risks are retired by id rather than by resubmitting the whole list, so a thread with fourteen risks costs one id to change one of them. The reply reports what changed, not what the record now holds.',
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

    const focusIds = input.focus
    const focusIdsPresent = focusIds ?? []
    const duplicatedFocusIds = focusIdsPresent.filter((id, index) => focusIdsPresent.indexOf(id) !== index)
    if (duplicatedFocusIds.length > 0) {
      return { ok: false, refusal: duplicateFocusRefusal([...new Set(duplicatedFocusIds)]) }
    }
    const unknownFocusIds = focusIdsPresent.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
    if (unknownFocusIds.length > 0) {
      return { ok: false, refusal: unknownFocusRefusal(unknownFocusIds) }
    }

    const criteriaDone = input.criteria_done ?? []
    const criteriaDoneIds = criteriaDone.map((entry) => entry.criterion_id)
    const duplicatedIds = criteriaDoneIds.filter((id, index) => criteriaDoneIds.indexOf(id) !== index)
    if (duplicatedIds.length > 0) {
      return { ok: false, refusal: duplicateCriterionRefusal([...new Set(duplicatedIds)]) }
    }
    const unknownCriteria = criteriaDoneIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
    if (unknownCriteria.length > 0) {
      return { ok: false, refusal: unknownCriterionRefusal(unknownCriteria) }
    }
    const struckCriteria = criteriaDoneIds.filter((id) =>
      thread.completion_criteria.some((c) => c.id === id && c.struck_by !== null)
    )
    if (struckCriteria.length > 0) {
      return { ok: false, refusal: struckCriterionRefusal(struckCriteria) }
    }
    const emptyResults = criteriaDone.filter((entry) => entry.result.trim().length === 0)
    if (emptyResults.length > 0) {
      return { ok: false, refusal: emptyResultRefusal(emptyResults.map((entry) => entry.criterion_id)) }
    }
    const escapedResults = criteriaDone.map((entry) => escapeStored(entry.result))
    const oversizedResultIndex = escapedResults.findIndex((result) => result.length > caps.CRITERION_RESULT_MAX)
    if (oversizedResultIndex !== -1) {
      const oversized = escapedResults[oversizedResultIndex]
      return {
        ok: false,
        refusal: resultCapRefusal(oversizedResultIndex, oversized === undefined ? 0 : oversized.length)
      }
    }
    const completions = new Map(
      criteriaDone.map((entry, index) => [
        entry.criterion_id,
        { result: escapedResults[index] as string, result_status: entry.result_status }
      ])
    )
    const contradicted = criteriaDone.filter((entry) => {
      const existing = thread.completion_criteria.find((c) => c.id === entry.criterion_id)
      if (existing === undefined || !existing.done) return false
      const completion = completions.get(entry.criterion_id)
      return existing.result !== completion?.result || existing.result_status !== completion?.result_status
    })
    if (contradicted.length > 0) {
      return { ok: false, refusal: contradictoryResultRefusal(contradicted.map((entry) => entry.criterion_id)) }
    }
    const markedDone = criteriaDoneIds.filter((id) => {
      const existing = thread.completion_criteria.find((c) => c.id === id)
      return existing !== undefined && !existing.done
    })
    const nextCriteria = thread.completion_criteria.map((c) => {
      const completion = completions.get(c.id)
      return completion === undefined
        ? c
        : { ...c, done: true, result: completion.result, result_status: completion.result_status }
    })

    const retireIds = input.risks_retire ?? []
    const retiredIds = retireIds.filter((id) => thread.spine.open_risks.some((r) => r.id === id))
    const survivingRisks = thread.spine.open_risks.filter((r) => !retireIds.includes(r.id))

    const newRisks: Risk[] = (input.risks_add ?? []).map((r) => ({
      id: rt.ulid(),
      scope: r.scope,
      text: r.text,
      refs: r.refs ?? [],
      criterion_id: r.criterion_id
    }))
    const danglingRiskCriteria = newRisks.filter(
      (r) => r.criterion_id !== undefined && !thread.completion_criteria.some((c) => c.id === r.criterion_id)
    )
    if (danglingRiskCriteria.length > 0) {
      return {
        ok: false,
        refusal: danglingRiskCriterionRefusal(danglingRiskCriteria.map((r) => r.criterion_id as string))
      }
    }

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

    const blockedBySupplied = input.blocked_by !== undefined
    const blockedByCleared = input.blocked_by_clear === true
    if (blockedBySupplied && blockedByCleared) {
      return { ok: false, refusal: conflictingBlockageRefusal() }
    }
    const escapedBlockedBy = input.blocked_by === undefined ? undefined : escapeStored(input.blocked_by)
    if (escapedBlockedBy !== undefined && escapedBlockedBy.length > caps.THREAD_BLOCKED_BY_MAX) {
      return { ok: false, refusal: blockedByCapRefusal(escapedBlockedBy.length) }
    }
    const blockageChanged = blockedBySupplied || blockedByCleared

    const nothingChanged =
      markedDone.length === 0 &&
      retiredIds.length === 0 &&
      newRisks.length === 0 &&
      newKeyDecisions.length === 0 &&
      newOutOfScope.length === 0 &&
      spineFieldsUpdated.length === 0 &&
      !blockageChanged

    const focusPlan = decideFocusOutcome(rt, thread.id, focusIds)
    if (!focusPlan.ok) return { ok: false, refusal: focusPlan.refusal }

    if (nothingChanged) {
      applyFocusPlan(rt, focusPlan.value)
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
          out_of_scope_added: [],
          blocked_by_set: false,
          focus_written: focusPlan.value.outcome.written,
          focus_not_written_reason: focusPlan.value.outcome.reason
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
      blocked_by: blockedByCleared ? null : (escapedBlockedBy ?? thread.blocked_by),
      completion_criteria: nextCriteria,
      spine: contributed.value,
      updated_at: rt.now()
    }

    const committed = commitThread(store, nextThread, `update thread ${thread.slug}`)
    if (!committed.ok) return { ok: false, refusal: committed.refusal }

    applyFocusPlan(rt, focusPlan.value)
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
        out_of_scope_added: newOutOfScope.map((o) => o.id),
        blocked_by_set: blockageChanged,
        focus_written: focusPlan.value.outcome.written,
        focus_not_written_reason: focusPlan.value.outcome.reason
      }
    }
  }
}
