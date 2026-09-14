import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import * as caps from '../../src/schema/caps.ts'
import type { KeyDecision, Thread } from '../../src/schema/thread.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { recordDecisionTool } from '../../src/server/tools/record_decision.ts'
import { openStore } from '../../src/store/records.ts'
import { STUB_TOOL_CTX, withCriterionFixture } from '../support/criterion-fixture.ts'

const readStoredThread = (rt: Runtime, threadId: string): Thread => {
  const opened = openStore(rt, rt.cwd)
  if (!opened.ok) throw new Error('link-skipped fixture: the store did not open')
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) throw new Error('link-skipped fixture: the thread did not read back')
  return slot.record
}

test('record-decision.records-the-decision-and-reports-the-skipped-link-when-the-thread-cannot-take-it', async () => {
  await withCriterionFixture(async (rt) => {
    const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'a thread already holding every key decision it can',
      slug: 'link-skipped-thread',
      active_goal: 'show a decision is kept when its spine link cannot be written',
      next_step: 'record one more decision',
      completion_criteria: [{ text: 'the decision is kept', check: 'read it back', settledness: 'proposed' as const }]
    })
    if (!opened.ok) throw new Error(`link-skipped fixture: open_thread refused: ${opened.refusal.message}`)
    const threadId = opened.structured.thread_id

    const store = openStore(rt, rt.cwd)
    if (!store.ok) throw new Error('link-skipped fixture: the store did not open')
    const stored = readStoredThread(rt, threadId)
    const fullLinks: KeyDecision[] = Array.from({ length: caps.KEY_DECISIONS_MAX_ELEMENTS }, (_, index) => ({
      id: rt.ulid(),
      decision_id: rt.ulid(),
      title: `seeded decision ${index}`,
      scope: 'seeded'
    }))
    const saturated: Thread = { ...stored, spine: { ...stored.spine, key_decisions: fullLinks } }
    assert.equal(store.value.commit([{ kind: 'thread', record: saturated }], 'saturate the key decisions').ok, true)

    const recorded = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'one decision past the link limit',
      context: 'the thread already links as many key decisions as its record allows',
      options: ['refuse the whole call', 'record the decision and skip the link'],
      outcome: 'record the decision and skip the link'
    })
    if (!recorded.ok) throw new Error(`expected record_decision to succeed; refused: ${recorded.refusal.message}`)

    assert.equal(recorded.structured.linked, false)
    assert.match(
      String(recorded.structured.link_skipped_reason),
      /^the thread record carrying this link failed its stored-shape validation, so the decision was recorded and the spine link was not written: /
    )

    const reopened = openStore(rt, rt.cwd)
    if (!reopened.ok) throw new Error('link-skipped fixture: the store did not reopen')
    const decision = reopened.value.readDecision(recorded.structured.decision_id)
    assert.ok(decision !== null && !decision.quarantined, 'the decision must be stored even though its link was skipped')
    if (decision === null || decision.quarantined) return
    assert.equal(decision.record.title, 'one decision past the link limit')

    const after = readStoredThread(rt, threadId)
    assert.deepEqual(after.spine.key_decisions, fullLinks)
  })
})
