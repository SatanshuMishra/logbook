export type Conflict = { record: string; field: string; ours: unknown; theirs: unknown }

export const conflict = (record: string, field: string, ours: unknown, theirs: unknown): Conflict => ({
  record,
  field,
  ours,
  theirs
})
