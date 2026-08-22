import { z } from 'zod'
import { declare } from './declare.ts'
import { ULID_PATTERN, ISO_PATTERN } from './ids.ts'
import * as caps from './caps.ts'
import type { Ulid, Iso8601 } from './thread.ts'

export type { Ulid, Iso8601 } from './thread.ts'

export type SessionEntry = {
  id: Ulid
  thread_id: Ulid
  actor: string
  body: string
  created_at: Iso8601
}

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const SessionShape = z.object({
  id: ulidField('the session entry identity, a ULID'),
  thread_id: ulidField('the thread this session entry belongs to'),
  actor: z.string().min(1).max(caps.SESSION_ACTOR_MAX).describe('who or what wrote this session entry'),
  body: z.string().max(caps.SESSION_BODY_MAX).describe('the session entry text'),
  created_at: z.string().regex(ISO_PATTERN).describe('when this session entry was written')
})

export const SessionRecord = declare<SessionEntry>('session', SessionShape)
