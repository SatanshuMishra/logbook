import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { commitOneThread, commitSessionEntry, resumeAs, startSession, stopEventFor, withFixture } from '../support/stop-gate-fixture.ts'

const SESSION_ID = 'stop-gate-recording-assertions-session'

const commitThreadWithFullRecord = (rt: Runtime, repo: string, slug: string): string => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const threadId = rt.ulid()
  const change: Extract<RecordChange, { kind: 'thread' }> = {
    kind: 'thread',
    record: {
      id: threadId,
      slug,
      title: 'a fully recorded stop gate thread',
      status: 'open',
      blocked_by: null,
      completion_criteria: [
        {
          id: rt.ulid(),
          ordinal: 1,
          text: 'a criterion still open',
          done: false,
          kind: 'planned',
          struck_by: null
        }
      ],
      artifacts: [{ id: rt.ulid(), label: 'a produced artifact', pointer: 'docs/example.md', retired: false }],
      spine: {
        active_goal: 'goal',
        next_step: 'next',
        landed: '',
        last_session: 'last',
        open_risks: [],
        key_decisions: [{ id: rt.ulid(), decision_id: rt.ulid(), title: 'a linked decision', scope: 'scope' }],
        out_of_scope: []
      },
      created_at: rt.now(),
      updated_at: rt.now()
    }
  }
  const committed = opened.value.commit([change], `seed ${slug}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
  return threadId
}

test('hook.stop-gate-presents-every-assertion-when-the-ledger-has-not-moved', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'recording-assertions')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind === 'block') {
      assert.ok(verdict.reason.includes('Every selection between options is recorded by whoever selected'))
      assert.ok(verdict.reason.includes("The thread's definition of done reflects what is now known"))
      assert.ok(verdict.reason.includes('The recorded next action is one someone could begin'))
      assert.ok(verdict.reason.includes('Everything a subagent returned but could not record itself'))
      assert.ok(
        verdict.reason.includes('reports only that the record is silent'),
        'the gate makes no claim about what the answer should be'
      )
    }
  })
})

test('hook.stop-gate-names-what-the-record-holds-nothing-for', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'nothing-linked')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind === 'block') {
      assert.ok(
        verdict.reason.includes('no decision is linked to this thread'),
        `the block names the observably empty category, got: ${verdict.reason}`
      )
    }
  })
})

test('hook.stop-gate-clears-once-any-write-moves-the-head-past-the-last-fire', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'clears-after-fire')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind, 'block')
    commitSessionEntry(rt, repo, threadId, 'anything at all')

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind,
      'silent',
      'the head moved off the value recorded at the fire, which is the whole clearing condition'
    )
  })
})

test('hook.stop-gate-stands-down-after-two-fires-and-a-fresh-human-turn', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stands-down')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind, 'block')
    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind, 'block')

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-two')).kind,
      'silent',
      'two fires and a fresh human turn stand the gate down; a gate that fires every turn is cleared reflexively'
    )
  })
})

test('hook.stop-gate-keeps-firing-on-two-fires-with-no-fresh-turn', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'no-fresh-turn')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))
    stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind,
      'block',
      'neither condition alone stands the gate down'
    )
  })
})

test('hook.stop-gate-keeps-firing-after-one-fire-and-a-fresh-turn', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'one-fire-fresh-turn')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind, 'block')

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-two')).kind,
      'block',
      'one fire plus a fresh human turn is only half the stand-down condition'
    )
  })
})

test('hook.stop-gate-names-nothing-silent-when-the-record-holds-all-three', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitThreadWithFullRecord(rt, repo, 'fully-recorded')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind === 'block') {
      assert.ok(verdict.reason.includes('Every selection between options is recorded by whoever selected'))
      assert.ok(verdict.reason.includes("The thread's definition of done reflects what is now known"))
      assert.ok(verdict.reason.includes('The recorded next action is one someone could begin'))
      assert.ok(verdict.reason.includes('Everything a subagent returned but could not record itself'))
      assert.equal(
        verdict.reason.includes('no decision is linked to this thread'),
        false,
        `the record holds a decision, so R-7 must render unqualified, got: ${verdict.reason}`
      )
      assert.equal(
        verdict.reason.includes('no un-struck criterion is on this thread'),
        false,
        `the record holds an un-struck criterion, so R-8 must render unqualified, got: ${verdict.reason}`
      )
      assert.equal(
        verdict.reason.includes('no artifact is named on this thread'),
        false,
        `the record holds an artifact, so R-10 must render unqualified, got: ${verdict.reason}`
      )
    }
  })
})
