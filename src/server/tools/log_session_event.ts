import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { RESERVED_ACTOR_PREFIX } from '../../domain/session-log.ts'
import { SessionRecord, type SessionEntry } from '../../schema/session.ts'
import { withDetail } from '../../store/detail.ts'
import { openProjectStore, loadThread } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const LogSessionEventInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread this session entry belongs to; the thread must currently be open'),
  actor: z.string().min(1).max(caps.SESSION_ACTOR_MAX).describe('who or what is speaking, for example claude or a person\'s handle'),
  body: z.string().max(caps.SESSION_BODY_MAX).describe('the entry text as Markdown, up to 8000 characters after escaping')
})

const LogSessionEventOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread the entry was logged against'),
  session_entry_id: z.string().describe('the id minted for the new session entry')
})

type LogSessionEventInput = z.infer<typeof LogSessionEventInputSchema>
type LogSessionEventOutput = z.infer<typeof LogSessionEventOutputSchema>

export const actorCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'actor',
  accepted: `at most ${caps.SESSION_ACTOR_MAX} characters after escaping`,
  example: 'claude',
  retryable: true,
  message: `actor exceeds its cap of ${caps.SESSION_ACTOR_MAX} characters after escaping; observed ${observed}; remedy: shorten the actor and retry.`
})

export const reservedActorPrefixRefusal = (): Refusal => ({
  ok: false,
  field: 'actor',
  accepted: `an actor name that does not begin with "${RESERVED_ACTOR_PREFIX}"`,
  example: 'claude',
  retryable: true,
  message: `actor begins with the reserved prefix "${RESERVED_ACTOR_PREFIX}", which marks entries Logbook writes for itself; remedy: choose an actor name that does not begin with "${RESERVED_ACTOR_PREFIX}" and retry.`
})

export const bodyCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'body',
  accepted: `at most ${caps.SESSION_BODY_MAX} characters after escaping`,
  example: 'shipped the merge queue fast path and verified it end to end',
  retryable: true,
  message: `body exceeds its cap of ${caps.SESSION_BODY_MAX} characters after escaping; observed ${observed}; remedy: shorten the entry and retry.`
})

export const invalidSessionEntryRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'body',
  accepted: 'a session entry that stays within its stored-shape caps',
  example: 'shorten the actor or body and retry',
  retryable: true,
  message: `the session entry failed its stored-shape validation: ${issue}`
})

export const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'body',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for this session entry did not complete; retry the call.'
    },
    detail
  )

export const logSessionEventTool: ToolSpec<LogSessionEventInput, LogSessionEventOutput> = {
  name: 'log_session_event',
  title: 'Log session event',
  description:
    "Appends one entry to a thread's session log, which is the running narrative of what actually happened. Takes the thread id, who is speaking as a short string such as claude or a person's handle, and the entry body as Markdown text up to 8000 characters. Entries are append-only and are never merged with each other, so two people logging at the same time both keep their entries. They are read on demand at logbook://session/{thread_id}/{entry_id} and are never loaded into a briefing by default.",
  input: LogSessionEventInputSchema,
  output: LogSessionEventOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const escapedActor = escapeStored(input.actor)
    if (escapedActor.length > caps.SESSION_ACTOR_MAX) {
      return { ok: false, refusal: actorCapRefusal(escapedActor.length) }
    }
    if (escapedActor.startsWith(RESERVED_ACTOR_PREFIX)) {
      return { ok: false, refusal: reservedActorPrefixRefusal() }
    }

    const escapedBody = escapeStored(input.body)
    if (escapedBody.length > caps.SESSION_BODY_MAX) {
      return { ok: false, refusal: bodyCapRefusal(escapedBody.length) }
    }

    const sessionEntry: SessionEntry = {
      id: rt.ulid(),
      thread_id: thread.id,
      actor: escapedActor,
      body: escapedBody,
      created_at: rt.now()
    }

    const validated = SessionRecord.parse(sessionEntry)
    if (!validated.ok) {
      return { ok: false, refusal: invalidSessionEntryRefusal(validated.message) }
    }

    const committed = store.commit(
      [{ kind: 'session', record: validated.value }],
      `log session event ${validated.value.id} on thread ${thread.slug}`
    )
    if (!committed.ok) {
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    return {
      ok: true,
      text: `logged session entry ${validated.value.id} on thread ${thread.slug}.`,
      structured: { thread_id: thread.id, session_entry_id: validated.value.id }
    }
  }
}
