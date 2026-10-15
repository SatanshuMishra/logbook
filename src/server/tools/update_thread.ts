import { z } from 'zod'
import { LETTER_SECTION, parseDocument, type Item } from '../../doc/document.ts'
import { addItem, oneLine, removeItem, replaceSection, tickCriterion, type EditResult } from '../../doc/render.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'
import { findRepository, startDirectory, type RepoPaths } from '../../thread/paths.ts'
import { applyToolChange } from '../../thread/reconcile.ts'
import { resolveThreadId } from '../../thread/store.ts'
import type { ToolSpec } from '../register.ts'

const TOOL_NAME = 'update_thread'
const NOT_BLANK = /\S/
const NEXT_STEP_SECTION = 'Next step'
const NOTHING_CHANGED = 'nothing changed'
const RECORDS_ACCEPTED = 'ids of items in the document, such as D3 or R1'
const CRITERION_ACCEPTED = `the id of a criterion under "## ${LETTER_SECTION.c}" in the thread's document, such as c1`
const RISK_ACCEPTED = `the id of a risk under "## ${LETTER_SECTION.R}" in the thread's document, such as R1`

const filledText = (description: string) => z.string().regex(NOT_BLANK).describe(description)

const CriterionDoneSchema = z
  .strictObject({
    criterion_id: z
      .string()
      .describe(
        `the id of a criterion under "## ${LETTER_SECTION.c}" in the thread's document, such as c1; refused when the document holds no such criterion`
      ),
    result: filledText(
      'what was observed that shows the criterion is met, written after " evidence: " on its line; refused when empty or only whitespace'
    )
  })
  .describe('one criterion to tick [x] with what proves it; a criterion already [x] is left as it is')

const RiskAddSchema = z
  .strictObject({
    text: filledText('the risk, written on one line; refused when empty or only whitespace'),
    bears_on: z
      .string()
      .optional()
      .describe(
        'the id of the criterion this risk bears on, such as c1, written after the text as " Bears on c1."; refused when the document holds no such criterion; omit it for a risk that bears on no one criterion'
      )
  })
  .describe(`one risk to add under "## ${LETTER_SECTION.R}" with the next free R id`)

const RiskRetireSchema = z
  .strictObject({
    risk_id: z
      .string()
      .describe(
        `the id of a risk under "## ${LETTER_SECTION.R}" in the thread's document, such as R1; refused when the document holds no such risk`
      ),
    reason: filledText(
      'why the risk no longer stands, kept in the commit as "Removed: <id> because <reason>"; refused when empty or only whitespace'
    )
  })
  .describe(`one risk to remove from "## ${LETTER_SECTION.R}"`)

const UpdateThreadInputSchema = z
  .strictObject({
    thread_id: z
      .string()
      .describe("the thread's slug, or an old thread id listed in aliases.json; call list_threads to see each slug"),
    next_step: z
      .string()
      .regex(NOT_BLANK)
      .optional()
      .describe(
        `replaces the body of "## ${NEXT_STEP_SECTION}": one action someone could begin without re-deriving anything; refused when empty or only whitespace; omit it to leave the next step as it is`
      ),
    next_step_records: z
      .array(z.string().describe('the id of one item of the document, such as D3 or R1'))
      .optional()
      .describe(
        'the ids of the document\'s items the next step needs, such as ["D3", "R1"], written after the next step as "Needs: D3, R1."; refused without next_step, and refused when it names an id the document does not hold'
      ),
    criteria_done: z
      .array(CriterionDoneSchema)
      .optional()
      .describe('criteria to tick [x], each with what proves it; a criterion already [x] is left as it is'),
    risks_add: z
      .array(RiskAddSchema)
      .optional()
      .describe(`risks to add under "## ${LETTER_SECTION.R}", each given the next free R id`),
    risks_retire: z
      .array(RiskRetireSchema)
      .optional()
      .describe(`risks to remove from "## ${LETTER_SECTION.R}", each with the reason it no longer stands`)
  })
  .superRefine((input, ctx) => {
    if (input.next_step_records !== undefined && input.next_step === undefined) {
      ctx.addIssue({
        code: 'invalid_value',
        values: [],
        path: ['next_step_records'],
        message: 'next_step_records was sent without next_step',
        input: input.next_step_records
      })
      return
    }
    const asksChange =
      input.next_step !== undefined ||
      (input.criteria_done?.length ?? 0) > 0 ||
      (input.risks_add?.length ?? 0) > 0 ||
      (input.risks_retire?.length ?? 0) > 0
    if (!asksChange) {
      ctx.addIssue({ code: 'invalid_value', values: [], path: [], message: 'the call asks no change', input })
    }
  })
  .describe(
    'the thread and at least one change to it: next_step, with next_step_records when the step needs items of the document, criteria_done, risks_add or risks_retire'
  )

const UpdateThreadOutputSchema = z.object({
  thread_id: z.string().describe('the slug of the thread that was updated'),
  summary: z.string().describe('what changed, in order, such as "next step set, ticked c1 c2, added R3, retired R1"'),
  added_risk_ids: z.array(z.string()).describe('the ids given to the risks in risks_add, in order, such as ["R2", "R3"]')
})

type UpdateThreadInput = z.infer<typeof UpdateThreadInputSchema>
type UpdateThreadOutput = z.infer<typeof UpdateThreadOutputSchema>
type CriterionDone = z.infer<typeof CriterionDoneSchema>
type RiskAdd = z.infer<typeof RiskAddSchema>
type RiskRetire = z.infer<typeof RiskRetireSchema>

type Outcome = { summary: string; addedRiskIds: string[] }

type Updated = ({ ok: true; text: string; noteLines: string[] } & Outcome) | { ok: false; refusal: Refusal }

type Edited = { ok: true; text: string; ids: string[]; noteLines: string[] } | { ok: false; refusal: Refusal }

const noWorkingDirectory = (): Refusal => ({
  ok: false,
  field: 'cwd',
  accepted: 'a readable working directory inside a git repository, or CLAUDE_PROJECT_DIR naming one',
  example: '/home/me/projects/my-app',
  retryable: false,
  message: 'logbook could not read its working directory and CLAUDE_PROJECT_DIR is not set, so it cannot find the repository'
})

const unknownCriterion = (field: string, id: string): Refusal => ({
  ok: false,
  field,
  accepted: CRITERION_ACCEPTED,
  example: 'c1',
  retryable: true,
  message: `${JSON.stringify(id)} is not a criterion of this thread, so nothing was committed; read the thread's document for the c ids under "## ${LETTER_SECTION.c}"`
})

const unknownRisk = (field: string, id: string): Refusal => ({
  ok: false,
  field,
  accepted: RISK_ACCEPTED,
  example: 'R1',
  retryable: true,
  message: `${JSON.stringify(id)} is not a risk of this thread, so nothing was committed; read the thread's document for the R ids under "## ${LETTER_SECTION.R}"`
})

const unknownRecords = (ids: readonly string[]): Refusal => ({
  ok: false,
  field: 'next_step_records',
  accepted: RECORDS_ACCEPTED,
  example: 'D1',
  retryable: true,
  message: `${ids.map((id) => JSON.stringify(id)).join(', ')} ${ids.length === 1 ? 'is not an item' : 'are not items'} of the thread's document once this call's changes are made, so nothing was committed; name the c, D, R or S ids the document holds`
})

const documentRefused = (message: string): Refusal => ({
  ok: false,
  field: 'document',
  accepted: 'a stored document holding every section of the state document format',
  example: `## ${LETTER_SECTION.R}`,
  retryable: false,
  message: `${message}, so nothing was committed`
})

const locate = (rt: Runtime): Ok<RepoPaths> | Refusal => {
  const dir = startDirectory(rt, rt.cwd ?? '')
  return dir === '' ? noWorkingDirectory() : findRepository(rt, dir)
}

const idsOf = (items: readonly Item[], letter: 'c' | 'R'): ReadonlySet<string> =>
  new Set(items.filter((item) => item.letter === letter && item.section === LETTER_SECTION[letter]).map((item) => item.id))

const firstOfEach = <T>(entries: readonly T[], idOf: (entry: T) => string): T[] =>
  entries.filter((entry, index) => entries.findIndex((other) => idOf(other) === idOf(entry)) === index)

const unique = (ids: readonly string[]): string[] => [...new Set(ids)]

const applyEdits = <T>(text: string, entries: readonly T[], edit: (text: string, entry: T) => EditResult): Edited =>
  entries.reduce<Edited>(
    (state, entry) => {
      if (!state.ok) return state
      const edited = edit(state.text, entry)
      if (!edited.ok) return { ok: false, refusal: documentRefused(edited.message) }
      return {
        ok: true,
        text: edited.text,
        ids: edited.id === null ? state.ids : [...state.ids, edited.id],
        noteLines: edited.noteLine === null ? state.noteLines : [...state.noteLines, edited.noteLine]
      }
    },
    { ok: true, text, ids: [], noteLines: [] }
  )

const riskLine = (risk: RiskAdd): string =>
  risk.bears_on === undefined ? oneLine(risk.text) : `${oneLine(risk.text)} Bears on ${risk.bears_on}.`

const nextStepBody = (nextStep: string, records: readonly string[]): string[] =>
  records.length === 0 ? [nextStep] : [nextStep, '', `Needs: ${records.join(', ')}.`]

const checkIds = (items: readonly Item[], input: UpdateThreadInput): Refusal | null => {
  const criteria = idsOf(items, 'c')
  const risks = idsOf(items, 'R')
  const done: readonly CriterionDone[] = input.criteria_done ?? []
  const doneIndex = done.findIndex((entry) => !criteria.has(entry.criterion_id))
  const doneEntry = done[doneIndex]
  if (doneEntry !== undefined) return unknownCriterion(`criteria_done.${doneIndex}.criterion_id`, doneEntry.criterion_id)
  const added: readonly RiskAdd[] = input.risks_add ?? []
  const addedIndex = added.findIndex((entry) => entry.bears_on !== undefined && !criteria.has(entry.bears_on))
  const addedEntry = added[addedIndex]
  if (addedEntry?.bears_on !== undefined) return unknownCriterion(`risks_add.${addedIndex}.bears_on`, addedEntry.bears_on)
  const retired: readonly RiskRetire[] = input.risks_retire ?? []
  const retiredIndex = retired.findIndex((entry) => !risks.has(entry.risk_id))
  const retiredEntry = retired[retiredIndex]
  if (retiredEntry !== undefined) return unknownRisk(`risks_retire.${retiredIndex}.risk_id`, retiredEntry.risk_id)
  return null
}

const withNextStep = (text: string, input: UpdateThreadInput): Edited => {
  if (input.next_step === undefined) return { ok: true, text, ids: [], noteLines: [] }
  const records = unique(input.next_step_records ?? [])
  const known = new Set(parseDocument(text).items.map((item) => item.id))
  const missing = records.filter((id) => !known.has(id))
  if (missing.length > 0) return { ok: false, refusal: unknownRecords(missing) }
  const replaced = replaceSection(text, NEXT_STEP_SECTION, nextStepBody(input.next_step, records))
  return replaced.ok
    ? { ok: true, text: replaced.text, ids: [], noteLines: [] }
    : { ok: false, refusal: documentRefused(replaced.message) }
}

const summaryOf = (input: UpdateThreadInput, ticked: readonly string[], added: readonly string[], retired: readonly string[]): string => {
  const parts = [
    ...(input.next_step === undefined ? [] : ['next step set']),
    ...(ticked.length === 0 ? [] : [`ticked ${ticked.join(' ')}`]),
    ...(added.length === 0 ? [] : [`added ${added.join(' ')}`]),
    ...(retired.length === 0 ? [] : [`retired ${retired.join(' ')}`])
  ]
  return parts.length === 0 ? NOTHING_CHANGED : parts.join(', ')
}

const updateIn = (text: string, input: UpdateThreadInput): Updated => {
  const items = parseDocument(text).items
  const refused = checkIds(items, input)
  if (refused !== null) return { ok: false, refusal: refused }
  const open = new Set(items.filter((item) => item.letter === 'c' && item.box !== 'x').map((item) => item.id))
  const toTick = firstOfEach(input.criteria_done ?? [], (entry) => entry.criterion_id).filter((entry) =>
    open.has(entry.criterion_id)
  )
  const ticked = applyEdits(text, toTick, (current, entry) => tickCriterion(current, entry.criterion_id, entry.result))
  if (!ticked.ok) return ticked
  const added = applyEdits(ticked.text, input.risks_add ?? [], (current, risk) => addItem(current, 'R', riskLine(risk)))
  if (!added.ok) return added
  const toRetire = firstOfEach(input.risks_retire ?? [], (entry) => entry.risk_id)
  const retired = applyEdits(added.text, toRetire, (current, entry) => removeItem(current, entry.risk_id, entry.reason))
  if (!retired.ok) return retired
  const stepped = withNextStep(retired.text, input)
  if (!stepped.ok) return stepped
  return {
    ok: true,
    text: stepped.text,
    noteLines: retired.noteLines,
    summary: summaryOf(input, ticked.ids, added.ids, retired.ids),
    addedRiskIds: added.ids
  }
}

export const updateThreadTool: ToolSpec<UpdateThreadInput, UpdateThreadOutput> = {
  name: TOOL_NAME,
  title: 'Update thread',
  description: `Changes a thread's document in one commit. next_step replaces the body of "## ${NEXT_STEP_SECTION}", followed by the line "Needs: <ids>." when next_step_records names the items of the document that step needs. criteria_done ticks each criterion [x] with its result as evidence, leaving one already [x] as it is. risks_add adds each risk under "## ${LETTER_SECTION.R}" with the next free R id, followed by " Bears on c<n>." when bears_on names a criterion. risks_retire removes each risk, keeping its reason in the commit. Send at least one change; every id must be an item the document holds. Returns what changed and the ids of the added risks.`,
  input: UpdateThreadInputSchema,
  output: UpdateThreadOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const paths = locate(rt)
    if (!paths.ok) return { ok: false, refusal: paths }
    const slug = resolveThreadId(rt, paths.value, input.thread_id)
    if (!slug.ok) return { ok: false, refusal: slug }
    let outcome = null as Outcome | null
    const applied = applyToolChange(rt, paths.value, slug.value, {
      tool: TOOL_NAME,
      change: (text) => {
        const updated = updateIn(text, input)
        if (!updated.ok) return updated
        outcome = { summary: updated.summary, addedRiskIds: updated.addedRiskIds }
        return { ok: true, text: updated.text, summary: updated.summary, details: [], noteLines: updated.noteLines }
      }
    })
    if (!applied.ok) return { ok: false, refusal: applied }
    applied.value.push?.unref()
    const settled = outcome ?? { summary: NOTHING_CHANGED, addedRiskIds: [] }
    return {
      ok: true,
      text: `updated thread ${slug.value}: ${settled.summary}`,
      structured: { thread_id: slug.value, summary: settled.summary, added_risk_ids: settled.addedRiskIds }
    }
  }
}
