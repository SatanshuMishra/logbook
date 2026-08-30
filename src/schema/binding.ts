import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, ISO_PATTERN } from './ids.ts'
import { pointer, structural } from './field-class.ts'
import * as caps from './caps.ts'
import type { Ulid, Iso8601 } from './thread.ts'

export type { Ulid, Iso8601 } from './thread.ts'

export type Binding = {
  id: Ulid
  thread_id: Ulid
  branch: string
  created_at: Iso8601
}

const ulidField = (description: string) => structural(z.string().regex(ULID_PATTERN).describe(description))

const BindingShape = z.object({
  id: ulidField('the binding identity, a ULID'),
  thread_id: ulidField('the thread this branch is bound to'),
  branch: pointer(caps.BINDING_BRANCH_MAX, 'the git branch name bound to this thread'),
  created_at: structural(z.string().regex(ISO_PATTERN).describe('when this binding was recorded'))
})

export const BindingRecord = declare<Binding>('binding', BindingShape)
