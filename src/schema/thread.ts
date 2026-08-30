import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, SLUG_PATTERN, ISO_PATTERN } from './ids.ts'
import { content, pointer, structural } from './field-class.ts'
import * as caps from './caps.ts'

export type Ulid = string
export type Iso8601 = string

export type ResultStatus = 'verified' | 'unverified-reasoned'

export type Criterion = {
  id: Ulid
  ordinal: number
  text: string
  done: boolean
  kind: 'planned' | 'detour'
  check?: string | null | undefined
  result?: string | null | undefined
  result_status?: ResultStatus | null | undefined
  struck_by: Ulid | null
}

export type Risk = { id: Ulid; scope: string; text: string; refs: string[]; criterion_id?: Ulid | undefined }
export type KeyDecision = { id: Ulid; decision_id: Ulid; title: string; scope: string; criterion_id?: Ulid | undefined }
export type OutOfScope = { id: Ulid; text: string }
export type Artifact = { id: Ulid; label: string; pointer: string }

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
  predecessor_id?: Ulid | undefined
  completion_criteria: Criterion[]
  artifacts?: Artifact[] | undefined
  spine: Spine
  created_at: Iso8601
  updated_at: Iso8601
}

const ulidField = (description: string) => structural(z.string().regex(ULID_PATTERN).describe(description))
const optionalUlidField = (description: string) =>
  structural(z.string().regex(ULID_PATTERN).optional().describe(description))
const isoField = (description: string) => structural(z.string().regex(ISO_PATTERN).describe(description))

const CriterionSchema = structural(
  z.object({
    id: ulidField('the criterion identity, a stable ULID that the merge keys on'),
    ordinal: structural(
      z.number().int().min(1).describe('the rendered position of this criterion, recomputed on render, never merged')
    ),
    text: content(z.string().max(caps.CRITERION_TEXT_MAX).describe('the criterion text')),
    done: structural(z.boolean().describe('whether this criterion has been satisfied')),
    kind: structural(
      z.enum(['planned', 'detour']).describe('whether this criterion was planned up front or added mid-thread')
    ),
    check: content(
      z
        .string()
        .max(caps.CRITERION_CHECK_MAX)
        .nullable()
        .optional()
        .describe('the re-runnable check that decides whether this criterion is true, absent when none is recorded')
    ),
    result: content(
      z
        .string()
        .max(caps.CRITERION_RESULT_MAX)
        .nullable()
        .optional()
        .describe('what the check returned when this criterion was marked done, absent when none is recorded')
    ),
    result_status: structural(
      z
        .enum(['verified', 'unverified-reasoned'])
        .nullable()
        .optional()
        .describe('whether the recorded result came from running the check, absent when none is recorded')
    ),
    struck_by: structural(
      z
        .string()
        .regex(ULID_PATTERN)
        .nullable()
        .describe('the decision id that struck this criterion, or null when it has not been struck')
    )
  })
)

const RiskSchema = structural(
  z.object({
    id: ulidField('the risk identity, a ULID'),
    scope: content(
      z.string().max(caps.RISK_SCOPE_MAX).describe('the criterion or area of the thread this risk concerns')
    ),
    text: content(z.string().max(caps.RISK_TEXT_MAX).describe('the risk text')),
    refs: z
      .array(pointer(caps.RISK_REF_MAX, 'one external pointer backing this risk'))
      .max(caps.RISK_REFS_MAX_ELEMENTS)
      .describe('external pointers backing this risk')
      .meta({ class: 'pointer' }),
    criterion_id: optionalUlidField('the criterion this risk ranks against, absent when the risk is unanchored')
  })
)

const KeyDecisionSchema = structural(
  z.object({
    id: ulidField('the key-decision link identity, a ULID'),
    decision_id: ulidField('the decision record this key decision links to'),
    title: content(
      z.string().max(caps.KEY_DECISION_TITLE_MAX).describe('the decision title as it should render on the spine')
    ),
    scope: content(
      z.string().max(caps.KEY_DECISION_SCOPE_MAX).describe('the criterion or area of the thread this decision resolved')
    ),
    criterion_id: optionalUlidField('the criterion this decision ranks against, absent when the decision is unanchored')
  })
)

const OutOfScopeSchema = structural(
  z.object({
    id: ulidField('the out-of-scope entry identity, a ULID'),
    text: content(z.string().max(caps.OUT_OF_SCOPE_TEXT_MAX).describe('the out-of-scope statement'))
  })
)

const ArtifactSchema = structural(
  z.object({
    id: ulidField('the artifact entry identity, a ULID'),
    label: content(z.string().min(1).max(caps.ARTIFACT_LABEL_MAX).describe('what this artifact is, in a few words')),
    pointer: pointer(caps.ARTIFACT_POINTER_MAX, 'a path or url naming where this artifact lives')
  })
)

const SpineSchema = z.object({
  active_goal: content(z.string().max(caps.SPINE_ACTIVE_GOAL_MAX).describe('the thread goal currently being worked')),
  next_step: content(z.string().max(caps.SPINE_NEXT_STEP_MAX).describe('the next concrete step in this thread')),
  last_session: content(z.string().max(caps.SPINE_LAST_SESSION_MAX).describe('a summary of the most recent session')),
  open_risks: z.array(RiskSchema).describe('risks still open on this thread').meta({ class: 'structural' }),
  key_decisions: z
    .array(KeyDecisionSchema)
    .max(caps.KEY_DECISIONS_MAX_ELEMENTS)
    .describe('decisions linked into the spine')
    .meta({ class: 'structural' }),
  out_of_scope: z
    .array(OutOfScopeSchema)
    .max(caps.OUT_OF_SCOPE_MAX_ELEMENTS)
    .describe('statements of what this thread explicitly excludes')
    .meta({ class: 'structural' })
})

const ThreadShape = z.object({
  id: ulidField('the thread identity, a ULID'),
  slug: content(
    z.string().min(1).max(caps.THREAD_SLUG_MAX).regex(SLUG_PATTERN).describe('a short lowercase label for the thread')
  ),
  title: content(z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the thread title')),
  status: structural(z.enum(['open', 'done', 'abandoned']).describe('the thread lifecycle state')),
  blocked_by: content(
    z
      .string()
      .max(caps.THREAD_BLOCKED_BY_MAX)
      .nullable()
      .describe('the reason this thread is blocked, or null when it is not blocked')
  ),
  predecessor_id: optionalUlidField(
    'the id of the thread this one succeeds, absent when this thread succeeds no earlier thread'
  ),
  completion_criteria: z
    .array(CriterionSchema)
    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
    .describe('the criteria that define this thread as done, struck criteria retained')
    .meta({ class: 'structural' }),
  artifacts: z
    .array(ArtifactSchema)
    .optional()
    .describe('the artifacts this thread produced, each a label and a pointer')
    .meta({ class: 'structural' }),
  spine: SpineSchema.describe('the progressive summary of this thread').meta({ class: 'structural' }),
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
