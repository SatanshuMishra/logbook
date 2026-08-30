import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, ISO_PATTERN, SHA_PATTERN } from './ids.ts'
import { content, structural } from './field-class.ts'
import * as caps from './caps.ts'
import type { Ulid, Iso8601 } from './thread.ts'

export type { Ulid, Iso8601 } from './thread.ts'

export type Decision = {
  id: Ulid
  thread_id: Ulid
  title: string
  context: string
  options: string[]
  outcome: string
  commit: string | null
  supersedes: Ulid[]
  created_at: Iso8601
}

const ulidField = (description: string) => structural(z.string().regex(ULID_PATTERN).describe(description))

const DecisionShape = z.object({
  id: ulidField('the decision identity, a ULID'),
  thread_id: ulidField('the thread this decision belongs to'),
  title: content(z.string().min(1).max(caps.DECISION_TITLE_MAX).describe('the decision title')),
  context: content(z.string().max(caps.DECISION_CONTEXT_MAX).describe('the context the decision was made in')),
  options: z
    .array(content(z.string().max(caps.DECISION_OPTION_MAX).describe('one option that was considered')))
    .max(caps.DECISION_OPTIONS_MAX_ELEMENTS)
    .describe('the options considered')
    .meta({ class: 'content' }),
  outcome: content(z.string().max(caps.DECISION_OUTCOME_MAX).describe('the chosen outcome and its rationale')),
  commit: z
    .string()
    .max(caps.DECISION_COMMIT_MAX)
    .regex(SHA_PATTERN)
    .nullable()
    .describe('the project HEAD sha at the time of recording, or null when it could not be read')
    .meta({ class: 'pointer' }),
  supersedes: z
    .array(structural(z.string().regex(ULID_PATTERN).describe('one decision id this decision supersedes')))
    .max(caps.DECISION_SUPERSEDES_MAX_ELEMENTS)
    .describe('decision ids this decision supersedes')
    .meta({ class: 'structural' }),
  created_at: structural(z.string().regex(ISO_PATTERN).describe('when this decision was recorded'))
})

export const DecisionRecord = declare<Decision>('decision', DecisionShape)
