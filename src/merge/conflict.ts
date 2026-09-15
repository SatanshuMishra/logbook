export type Conflict = { record: string; field: string; ours: unknown; theirs: unknown }

export const conflict = (record: string, field: string, ours: unknown, theirs: unknown): Conflict => ({
  record,
  field,
  ours,
  theirs
})

export const NEXT_STEP_PAIR_NOTE =
  ' spine.next_step and spine.next_step_criterion_id of one record are a next step and the criterion it advances, so name the same winner for both.'

export const nextStepPairNoteFor = (fields: readonly string[]): string =>
  fields.some((field) => field.endsWith('spine.next_step') || field.endsWith('spine.next_step_criterion_id'))
    ? NEXT_STEP_PAIR_NOTE
    : ''
