import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, SLUG_PATTERN, ISO_PATTERN } from './ids.ts'
import * as caps from './caps.ts'

export type Ulid = string
export type Iso8601 = string

export type Criterion = {
  id: Ulid
  ordinal: number
  text: string
  done: boolean
  kind: 'planned' | 'detour'
  struck_by: Ulid | null
}

export type Risk = { id: Ulid; scope: string; text: string; refs: string[] }
export type KeyDecision = { id: Ulid; decision_id: Ulid; title: string; scope: string }
export type OutOfScope = { id: Ulid; text: string }

export type Spine = {
  active_goal: string
  next_step: string
  last_session: string
  open_risks: Risk[]
  key_decisions: KeyDecision[]
  out_of_scope: OutOfScope[]
}

export type Thread = {
  id: Ulid
  slug: string
  title: string
  status: 'open' | 'done' | 'abandoned'
  blocked_by: string | null
  completion_criteria: Criterion[]
  spine: Spine
  created_at: Iso8601
  updated_at: Iso8601
}

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)
const isoField = (description: string) => z.string().regex(ISO_PATTERN).describe(description)

const CriterionSchema = z.object({
  id: ulidField('the criterion identity, a stable ULID that the merge keys on'),
  ordinal: z
    .number()
    .int()
    .min(1)
    .describe('the rendered position of this criterion, recomputed on render, never merged'),
  text: z.string().max(caps.CRITERION_TEXT_MAX).describe('the criterion text'),
  done: z.boolean().describe('whether this criterion has been satisfied'),
  kind: z.enum(['planned', 'detour']).describe('whether this criterion was planned up front or added mid-thread'),
  struck_by: z
    .string()
    .regex(ULID_PATTERN)
    .nullable()
    .describe('the decision id that struck this criterion, or null when it has not been struck')
})

const RiskSchema = z.object({
  id: ulidField('the risk identity, a ULID'),
  scope: z.string().max(caps.RISK_SCOPE_MAX).describe('the criterion or area of the thread this risk concerns'),
  text: z.string().max(caps.RISK_TEXT_MAX).describe('the risk text'),
  refs: z
    .array(z.string().max(caps.RISK_REF_MAX))
    .max(caps.RISK_REFS_MAX_ELEMENTS)
    .describe('external pointers backing this risk')
})

const KeyDecisionSchema = z.object({
  id: ulidField('the key-decision link identity, a ULID'),
  decision_id: ulidField('the decision record this key decision links to'),
  title: z.string().max(caps.KEY_DECISION_TITLE_MAX).describe('the decision title as it should render on the spine'),
  scope: z.string().max(caps.KEY_DECISION_SCOPE_MAX).describe('the criterion or area of the thread this decision resolved')
})

const OutOfScopeSchema = z.object({
  id: ulidField('the out-of-scope entry identity, a ULID'),
  text: z.string().max(caps.OUT_OF_SCOPE_TEXT_MAX).describe('the out-of-scope statement')
})

const SpineSchema = z.object({
  active_goal: z.string().max(caps.SPINE_ACTIVE_GOAL_MAX).describe('the thread goal currently being worked'),
  next_step: z.string().max(caps.SPINE_NEXT_STEP_MAX).describe('the next concrete step in this thread'),
  last_session: z.string().max(caps.SPINE_LAST_SESSION_MAX).describe('a summary of the most recent session'),
  open_risks: z.array(RiskSchema).max(caps.OPEN_RISKS_MAX_ELEMENTS).describe('risks still open on this thread'),
  key_decisions: z
    .array(KeyDecisionSchema)
    .max(caps.KEY_DECISIONS_MAX_ELEMENTS)
    .describe('decisions linked into the spine'),
  out_of_scope: z
    .array(OutOfScopeSchema)
    .max(caps.OUT_OF_SCOPE_MAX_ELEMENTS)
    .describe('statements of what this thread explicitly excludes')
})

const ThreadShape = z.object({
  id: ulidField('the thread identity, a ULID'),
  slug: z
    .string()
    .min(1)
    .max(caps.THREAD_SLUG_MAX)
    .regex(SLUG_PATTERN)
    .describe('a short lowercase label for the thread'),
  title: z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the thread title'),
  status: z.enum(['open', 'done', 'abandoned']).describe('the thread lifecycle state'),
  blocked_by: z
    .string()
    .max(caps.THREAD_BLOCKED_BY_MAX)
    .nullable()
    .describe('the reason this thread is blocked, or null when it is not blocked'),
  completion_criteria: z
    .array(CriterionSchema)
    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
    .describe('the criteria that define this thread as done, struck criteria retained'),
  spine: SpineSchema.describe('the progressive summary of this thread'),
  created_at: isoField('when this thread was created'),
  updated_at: isoField('when this thread was last updated')
})

const ThreadShapeWithByteCap = ThreadShape.superRefine((value, ctx) => {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) {
    ctx.addIssue({
      code: 'too_big',
      origin: 'string',
      maximum: caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      inclusive: true,
      path: [],
      message: `serialised thread record exceeds ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes`,
      input: value
    })
  }
})

export const ThreadRecord = declare<Thread>('thread', ThreadShapeWithByteCap)
