import path from 'node:path'
import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import { ULID_PATTERN, BRANCH_PATTERN } from '../../schema/ids.ts'
import * as caps from '../../schema/caps.ts'
import { escapeStored } from '../../render/escape.ts'
import { BindingRecord, type Binding } from '../../schema/binding.ts'
import { layoutFor } from '../../store/layout.ts'
import { readAllRecordFiles } from '../../store/read-path.ts'
import { withDetail } from '../../store/detail.ts'
import { loadThread, openProjectStore } from '../tool-support.ts'

const ulidField = (description: string) => z.string().regex(ULID_PATTERN).describe(description)

const BindBranchInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread this branch belongs to'),
  branch: z
    .string()
    .min(1)
    .max(caps.BINDING_BRANCH_MAX)
    .regex(BRANCH_PATTERN)
    .describe('the git branch name to bind, for example feat/logbook-m4-lifecycle-tools')
})

const BindBranchOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread the branch is bound to'),
  branch: z.string().max(caps.BINDING_BRANCH_MAX).describe('the branch name that was bound'),
  binding_id: z.string().describe('the id of the binding record, whether newly created or already existing'),
  created: z.boolean().describe('true when a new binding was written; false when the pair was already bound and nothing changed')
})

type BindBranchInput = z.infer<typeof BindBranchInputSchema>
type BindBranchOutput = z.infer<typeof BindBranchOutputSchema>

export const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'branch',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for this binding did not complete; retry the call.'
    },
    detail
  )

export const invalidBindingRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'branch',
  accepted: 'a branch name that stays within the stored binding shape',
  example: 'feat/logbook-m4-lifecycle-tools',
  retryable: true,
  message: `the binding record failed its stored-shape validation: ${issue}`
})

export const bindBranchTool: ToolSpec<BindBranchInput, BindBranchOutput> = {
  name: 'bind_branch',
  title: 'Bind branch',
  description:
    'Links a working git branch to a thread so a later session can tell which thread a branch belongs to. Takes a thread id and a branch name; binding the same pair twice is not an error and changes nothing. The binding is stored with the ledger and shared with the team, unlike the record of which thread is being worked right now, which stays on one machine. Nothing warns when a branch and its thread drift apart; that is deliberate and deferred.',
  input: BindBranchInputSchema,
  output: BindBranchOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const escapedBranch = escapeStored(input.branch)

    const bindingsDir = path.join(layout.value.records, 'bindings')
    const existingSlots = readAllRecordFiles<Binding>(bindingsDir, BindingRecord)
    const existing = existingSlots.find(
      (slot) => !slot.quarantined && slot.record.thread_id === input.thread_id && slot.record.branch === escapedBranch
    )
    if (existing !== undefined && !existing.quarantined) {
      return {
        ok: true,
        text: `branch ${escapedBranch} is already bound to thread ${thread.slug}; nothing changed.`,
        structured: { thread_id: input.thread_id, branch: escapedBranch, binding_id: existing.record.id, created: false }
      }
    }

    const binding: Binding = {
      id: rt.ulid(),
      thread_id: input.thread_id,
      branch: escapedBranch,
      created_at: rt.now()
    }
    const validated = BindingRecord.parse(binding)
    if (!validated.ok) {
      return { ok: false, refusal: invalidBindingRefusal(validated.message) }
    }

    const committed = store.commit(
      [{ kind: 'raw', relPath: path.join('bindings', `${binding.id}.json`), content: JSON.stringify(validated.value) }],
      `bind branch ${escapedBranch} to thread ${thread.slug}`
    )
    if (!committed.ok) {
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    return {
      ok: true,
      text: `bound branch ${escapedBranch} to thread ${thread.slug}.`,
      structured: { thread_id: input.thread_id, branch: escapedBranch, binding_id: binding.id, created: true }
    }
  }
}
