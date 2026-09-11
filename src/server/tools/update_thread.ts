import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import type { Artifact, KeyDecision, Risk, Settledness, Spine, Thread } from '../../schema/thread.ts'
import { criterionSettledness } from '../../schema/thread.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { contributeToSpine, type SpineContribution } from '../../domain/spine.ts'
import {
  ArtifactAddSchema,
  commitThread,
  loadThread,
  mintArtifacts,
  openProjectStore,
  refuseOverThreadByteCap
} from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)
const optionalUlidField = (description: string) => z.string().regex(ULID_PATTERN).optional().describe(description)

const RiskAddSchema = z
  .strictObject({
    text: z.string().min(1).describe('the risk text to record on the spine'),
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

export const MARK_DONE_INVARIANTS = [
  'Marking a criterion done is a claim that it is met, and this field is where you record what convinced you.',
  'Before you write it, satisfy yourself that each of the following holds. Logbook checks none of them and stores what you write verbatim.',
  '- What was observed would look different if this work had not been done at all.',
  '- What was observed is the thing this criterion names, not a proxy that usually moves with it.',
  '- Where this criterion names something a person would look at or use, that surface was checked and not only the code behind it.',
  '- What was observed covers everything this criterion claims, not the part that was easiest to reach.',
  '- What was observed was seen against the work as it stands now, rather than recalled from earlier or carried over from a related change.',
  '- Anything this criterion claims that you did not observe is written here as not observed.',
  'Where you cannot yet satisfy one of these, gather what you need before marking it done rather than writing around it.'
].join('\n')

const CriterionDoneSchema = z
  .strictObject({
    criterion_id: ulidField('the id of a completion criterion already present on this thread'),
    result: z
      .string()
      .describe(MARK_DONE_INVARIANTS),
    result_status: z
      .enum(['verified', 'unverified-reasoned'])
      .describe('verified when the check was run and result is what it returned; unverified-reasoned when the check could not be run and result says why')
  })
  .describe('one criterion to mark done, as an object carrying what was observed; the bare criterion id string this argument took before is refused, so send {"criterion_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "result": "436 tests, 0 fail, exit 0", "result_status": "verified"} in place of "01ARZ3NDEKTSV4RRFFQ69G5FAV"')

const CriterionSettledSchema = z
  .strictObject({
    criterion_id: ulidField('the id of a completion criterion already present on this thread'),
    settledness: z
      .enum(['confirmed', 'proposed', 'unsettled'])
      .describe(
        'who stands behind this criterion now: confirmed when the human stated or agreed it, proposed when you derived it, unsettled when done is genuinely not known for this part yet'
      ),
    settled_by: z
      .string()
      .regex(/\S/)
      .optional()
      .describe('the human words behind a confirmed criterion, quoted verbatim; refused on any other settledness')
  })
  .describe('one criterion to settle, as an object carrying who stands behind it and, when confirmed, their own words')

const UpdateThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to update'),
  criteria_done: z
    .array(CriterionDoneSchema)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('criteria to mark done, each carrying what was observed; an id not present on the thread is refused'),
  criteria_settled: z
    .array(CriterionSettledSchema)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe(
      'criteria to settle, each recording who stands behind it now; a settlement may move a criterion between any two values, and leaving confirmed drops the quote that stood behind it'
    ),
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
    .describe(
      'risk ids to retire, for example ["01ARZ3NDEKTSV4RRFFQ69G5FAV"]; the entry is marked rather than deleted so the removal survives a sync'
    ),
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
  artifacts_add: z
    .array(ArtifactAddSchema)
    .max(caps.ARTIFACTS_PER_CALL_MAX_ELEMENTS)
    .optional()
    .describe('documents to append to this thread; each one is minted a stable id'),
  artifacts_retire: z
    .array(ulidField('the id of an artifact currently on this thread'))
    .max(caps.ARTIFACTS_PER_CALL_MAX_ELEMENTS)
    .optional()
    .describe(
      'artifact ids to remove; the entry is marked rather than deleted so the removal survives a sync'
    )
})

const UpdateThreadOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread that was updated'),
  criteria_marked_done: z.array(z.string()).describe('ids of criteria newly marked done by this call'),
  criteria_newly_settled: z.array(z.string()).describe('ids of criteria whose settledness or quote this call changed'),
  spine_fields_updated: z
    .array(z.enum(['active_goal', 'next_step', 'last_session']))
    .describe('which scalar spine fields this call changed'),
  risks_added: z.array(z.string()).describe('ids minted for risks this call added'),
  risks_retired: z.array(z.string()).describe('ids of risks this call marked removed'),
  key_decisions_added: z.array(z.string()).describe('ids minted for key decisions this call linked into the spine'),
  out_of_scope_added: z.array(z.string()).describe('ids minted for out-of-scope statements this call added'),
  artifacts_added: z.array(z.string()).describe('ids minted for artifacts this call added'),
  artifacts_retired: z.array(z.string()).describe('ids of artifacts this call marked removed'),
  blocked_by_set: z.boolean().describe('whether this call changed what the thread is blocked on, by either setting or clearing it')
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
  message: `criteria_done carries an empty result for these criteria, and a criterion is never marked done without one: ${ids.join(', ')}; remedy: ${MARK_DONE_INVARIANTS}`
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

const unsettledCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'only criteria that state a claim a check could decide, so proposed or confirmed ones',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_done reports a result for criteria that are still unsettled, and an unsettled criterion asserts nothing for a result to report: ${ids.join(', ')}; remedy: once the human has answered, settle each one through criteria_settled and then mark it done, or through amend_criteria strike each one and insert a criterion that states an actual claim with a check.`
})

const unsettlingADoneCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_settled',
  accepted: 'a settlement to unsettled only on a criterion this call does not leave marked done',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_settled moves criteria to unsettled that this call would leave marked done, and an unsettled criterion asserts nothing for a result to report: ${ids.join(', ')}; remedy: settle each one as proposed or confirmed to keep the recorded result, or through amend_criteria strike each one and insert a criterion naming the open question instead.`
})

const settlementCheckOwedRefusal = (index: number, settledness: string): Refusal => ({
  ok: false,
  field: 'criteria_settled',
  accepted: 'a settlement to confirmed or proposed only on a criterion that already carries a check',
  example: 'npm test exits 0',
  retryable: true,
  message: `criteria_settled[${index}] settles a criterion to ${settledness} and that criterion carries no check; a criterion that asserts something needs something to decide it; remedy: give it a check through an amend_criteria rewrite first, then settle it.`
})

const duplicateSettlementRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_settled',
  accepted: 'at most one entry per criterion id in a single call',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_settled names the same criterion more than once, so no single settledness could be stored for it: ${ids.join(', ')}.`
})

const unknownSettlementCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_settled',
  accepted: 'only criterion ids already present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_settled names ids not present on this thread: ${ids.join(', ')}.`
})

const struckSettlementCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_settled',
  accepted: 'only un-struck criterion ids present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_settled names criteria that have already been struck and take no further settlement: ${ids.join(', ')}.`
})

const settlementQuoteOwedRefusal = (index: number): Refusal => ({
  ok: false,
  field: 'criteria_settled',
  accepted: 'the human words behind a confirmed criterion, quoted verbatim',
  example: 'it has to block before the turn ends',
  retryable: true,
  message: `criteria_settled[${index}] is confirmed and carries no settled_by; remedy: quote what the human said, or record it as proposed.`
})

const settlementQuoteNotOwedRefusal = (index: number, settledness: string): Refusal => ({
  ok: false,
  field: 'criteria_settled',
  accepted: 'settled_by only on a confirmed criterion',
  example: 'omit settled_by',
  retryable: true,
  message: `criteria_settled[${index}] is ${settledness} and carries a settled_by quote; remedy: drop the quote, or record the criterion as confirmed if the human really said it.`
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

export const updateThreadTool: ToolSpec<UpdateThreadInput, UpdateThreadOutput> = {
  name: 'update_thread',
  title: 'Update thread',
  description:
    'Records mid-session progress on one thread: mark criteria done, refresh any of the six running-summary fields, set or clear what the thread is blocked on, and add or retire risks. Every argument is optional and only what is supplied is written, so a call carrying just criteria_done: [{"criterion_id": "<criterion ulid>", "result": "<what the check returned>", "result_status": "verified"}] changes nothing else. Marking a criterion done records what was observed and whether the check was actually run, and it is refused without both. Risks are retired by id rather than by resubmitting the whole list, so a thread with fourteen risks costs one id to change one of them. The criteria_settled argument records who stands behind a criterion, so an answer the human gave lands on the criterion it was about, and a confirmed one carries their own words while any other settledness carries none. The reply reports what changed, not what the record now holds.',
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
    const rawResultCriteria = thread.completion_criteria.map((c) => {
      const doneEntry = criteriaDone.find((entry) => entry.criterion_id === c.id)
      return doneEntry === undefined ? c : { ...c, result: doneEntry.result }
    })
    const rawResultProspective: Thread = { ...thread, completion_criteria: rawResultCriteria }
    const rawResultOverCap = refuseOverThreadByteCap(rawResultProspective)
    if (rawResultOverCap !== null) {
      return { ok: false, refusal: rawResultOverCap }
    }
    const escapedResults = criteriaDone.map((entry) => escapeStored(entry.result))
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

    const criteriaSettled = input.criteria_settled ?? []
    const criteriaSettledIds = criteriaSettled.map((entry) => entry.criterion_id)
    const duplicatedSettledIds = criteriaSettledIds.filter((id, index) => criteriaSettledIds.indexOf(id) !== index)
    if (duplicatedSettledIds.length > 0) {
      return { ok: false, refusal: duplicateSettlementRefusal([...new Set(duplicatedSettledIds)]) }
    }
    const unknownSettledCriteria = criteriaSettledIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
    if (unknownSettledCriteria.length > 0) {
      return { ok: false, refusal: unknownSettlementCriterionRefusal(unknownSettledCriteria) }
    }
    const struckSettledCriteria = criteriaSettledIds.filter((id) =>
      thread.completion_criteria.some((c) => c.id === id && c.struck_by !== null)
    )
    if (struckSettledCriteria.length > 0) {
      return { ok: false, refusal: struckSettlementCriterionRefusal(struckSettledCriteria) }
    }
    const settlementCheckOwedIndex = criteriaSettled.findIndex((entry) => {
      if (entry.settledness === 'unsettled') return false
      const existing = thread.completion_criteria.find((c) => c.id === entry.criterion_id)
      return existing !== undefined && (existing.check === undefined || existing.check === null)
    })
    if (settlementCheckOwedIndex !== -1) {
      const entry = criteriaSettled[settlementCheckOwedIndex]
      return {
        ok: false,
        refusal: settlementCheckOwedRefusal(settlementCheckOwedIndex, entry === undefined ? '' : entry.settledness)
      }
    }
    const rawSettledCriteria = thread.completion_criteria.map((c) => {
      const settledEntry = criteriaSettled.find((entry) => entry.criterion_id === c.id)
      return settledEntry === undefined
        ? c
        : { ...c, settled_by: settledEntry.settledness === 'confirmed' ? (settledEntry.settled_by ?? null) : null }
    })
    const rawSettledProspective: Thread = { ...thread, completion_criteria: rawSettledCriteria }
    const rawSettledOverCap = refuseOverThreadByteCap(rawSettledProspective)
    if (rawSettledOverCap !== null) {
      return { ok: false, refusal: rawSettledOverCap }
    }
    const escapedSettlements = criteriaSettled.map((entry) => ({
      criterion_id: entry.criterion_id,
      settledness: entry.settledness,
      settled_by: entry.settled_by === undefined ? undefined : escapeStored(entry.settled_by)
    }))
    const quoteOwedIndex = escapedSettlements.findIndex(
      (entry) => entry.settledness === 'confirmed' && (entry.settled_by === undefined || entry.settled_by.length === 0)
    )
    if (quoteOwedIndex !== -1) {
      return { ok: false, refusal: settlementQuoteOwedRefusal(quoteOwedIndex) }
    }
    const quoteNotOwedIndex = escapedSettlements.findIndex(
      (entry) => entry.settledness !== 'confirmed' && entry.settled_by !== undefined
    )
    if (quoteNotOwedIndex !== -1) {
      const entry = escapedSettlements[quoteNotOwedIndex]
      return {
        ok: false,
        refusal: settlementQuoteNotOwedRefusal(quoteNotOwedIndex, entry === undefined ? '' : entry.settledness)
      }
    }
    const settlements = new Map<string, { settledness: Settledness; settled_by: string | null }>(
      escapedSettlements.map((entry) => [
        entry.criterion_id,
        {
          settledness: entry.settledness,
          settled_by: entry.settledness === 'confirmed' ? (entry.settled_by ?? null) : null
        }
      ])
    )
    const settledIds = criteriaSettledIds.filter((id) => {
      const existing = thread.completion_criteria.find((c) => c.id === id)
      const settlement = settlements.get(id)
      if (existing === undefined || settlement === undefined) return false
      return existing.settledness !== settlement.settledness || (existing.settled_by ?? null) !== settlement.settled_by
    })

    const nextCriteria = thread.completion_criteria.map((c) => {
      const completion = completions.get(c.id)
      const completed =
        completion === undefined
          ? c
          : { ...c, done: true, result: completion.result, result_status: completion.result_status }
      const settlement = settlements.get(c.id)
      return settlement === undefined
        ? completed
        : { ...completed, settledness: settlement.settledness, settled_by: settlement.settled_by }
    })

    const touchedIds = new Set([...completions.keys(), ...settlements.keys()])
    const doneAndUnsettled = nextCriteria.filter(
      (c) => touchedIds.has(c.id) && c.struck_by === null && c.done && criterionSettledness(c) === 'unsettled'
    )
    const unsettledBySettlement = doneAndUnsettled.filter((c) => settlements.get(c.id)?.settledness === 'unsettled')
    if (unsettledBySettlement.length > 0) {
      return { ok: false, refusal: unsettlingADoneCriterionRefusal(unsettledBySettlement.map((c) => c.id)) }
    }
    if (doneAndUnsettled.length > 0) {
      return { ok: false, refusal: unsettledCriterionRefusal(doneAndUnsettled.map((c) => c.id)) }
    }

    const retireIds = input.risks_retire ?? []
    const retiredIds = retireIds.filter((id) => thread.spine.open_risks.some((r) => r.id === id && !r.retired))
    const survivingRisks = thread.spine.open_risks.map((r) => (retireIds.includes(r.id) ? { ...r, retired: true } : r))

    const retireArtifactIds = input.artifacts_retire ?? []
    const retiredArtifactIds = retireArtifactIds.filter((id) => (thread.artifacts ?? []).some((a) => a.id === id && !a.retired))
    const survivingArtifacts = (thread.artifacts ?? []).map((a) =>
      retireArtifactIds.includes(a.id) ? { ...a, retired: true } : a
    )
    const newArtifacts: Artifact[] = mintArtifacts(rt, input.artifacts_add ?? [])

    const newRisks: Risk[] = (input.risks_add ?? []).map((r) => ({
      id: rt.ulid(),
      scope: r.scope,
      text: r.text,
      refs: r.refs ?? [],
      criterion_id: r.criterion_id,
      retired: false
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
      settledIds.length === 0 &&
      retiredIds.length === 0 &&
      newRisks.length === 0 &&
      newKeyDecisions.length === 0 &&
      newOutOfScope.length === 0 &&
      newArtifacts.length === 0 &&
      retiredArtifactIds.length === 0 &&
      spineFieldsUpdated.length === 0 &&
      !blockageChanged

    if (nothingChanged) {
      return {
        ok: true,
        text: `no fields were supplied; thread ${thread.slug} is unchanged.`,
        structured: {
          thread_id: thread.id,
          criteria_marked_done: [],
          criteria_newly_settled: [],
          spine_fields_updated: [],
          risks_added: [],
          risks_retired: [],
          key_decisions_added: [],
          out_of_scope_added: [],
          artifacts_added: [],
          artifacts_retired: [],
          blocked_by_set: false
        }
      }
    }

    const rawRiskProspective: Thread = {
      ...thread,
      spine: { ...thread.spine, open_risks: [...survivingRisks, ...newRisks] }
    }
    const rawRiskOverCap = refuseOverThreadByteCap(rawRiskProspective)
    if (rawRiskOverCap !== null) {
      return { ok: false, refusal: rawRiskOverCap }
    }

    const spineForContribution: Spine = { ...thread.spine, open_risks: survivingRisks }
    const contributed = contributeToSpine(spineForContribution, spineContribution)
    if (!contributed.ok) {
      return { ok: false, refusal: contributed }
    }

    const combinedArtifacts = [...survivingArtifacts, ...newArtifacts]

    const nextThread: Thread = {
      ...thread,
      blocked_by: blockedByCleared ? null : (escapedBlockedBy ?? thread.blocked_by),
      completion_criteria: nextCriteria,
      ...(combinedArtifacts.length === 0 && thread.artifacts === undefined ? {} : { artifacts: combinedArtifacts }),
      spine: contributed.value,
      updated_at: rt.now()
    }

    const committed = commitThread(store, nextThread, `update thread ${thread.slug}`)
    if (!committed.ok) return { ok: false, refusal: committed.refusal }

    return {
      ok: true,
      text: `updated thread ${thread.slug}: ${markedDone.length} criteria marked done, ${settledIds.length} criteria settled, ${newRisks.length} risks added, ${retiredIds.length} risks retired.`,
      structured: {
        thread_id: committed.value.id,
        criteria_marked_done: markedDone,
        criteria_newly_settled: settledIds,
        spine_fields_updated: spineFieldsUpdated,
        risks_added: newRisks.map((r) => r.id),
        risks_retired: retiredIds,
        key_decisions_added: newKeyDecisions.map((kd) => kd.id),
        out_of_scope_added: newOutOfScope.map((o) => o.id),
        artifacts_added: newArtifacts.map((a) => a.id),
        artifacts_retired: retiredArtifactIds,
        blocked_by_set: blockageChanged
      }
    }
  }
}
