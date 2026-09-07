import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { layoutFor } from '../../src/store/layout.ts'
import { subagentStopGateVerdict } from '../../src/hooklib/subagent-stop-gate.ts'
import { runHookProcessWithEvent } from './hook-process.ts'
import {
  commitOneThread,
  commitSessionEntry,
  startSession,
  subagentEventFor,
  withFixture
} from '../support/stop-gate-fixture.ts'

const SESSION_ID = 'subagent-stop-gate-session'

test('hook.subagent-gate-presents-all-six-assertions', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-presents-all-six-assertions')
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind === 'block') {
      assert.ok(verdict.reason.includes('Every cause, measurement or approach this agent established'))
      assert.ok(verdict.reason.includes('Every approach tried and abandoned is recorded, with what made it fail'))
      assert.ok(verdict.reason.includes('Every fault this agent observed in what it read is recorded'))
      assert.ok(verdict.reason.includes('Every file this agent produced or changed is named'))
      assert.ok(verdict.reason.includes('Where the work stopped is recorded'))
      assert.ok(verdict.reason.includes('Everything this agent could not determine is recorded'))
      assert.ok(
        verdict.reason.includes('return message'),
        'an agent holding no ledger tool must be told where else its material can go'
      )
      assert.ok(
        verdict.reason.includes('reports only that the record is silent'),
        'the gate makes no claim about what the answer should be'
      )
      assert.ok(verdict.reason.includes('makes no claim about what the answer should be'))
    }
  })
})

test('hook.subagent-gate-fires-at-most-once-per-agent', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-fires-at-most-once-per-agent')
    startSession(rt, repo, SESSION_ID)

    assert.equal(subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one')).kind, 'block')

    assert.equal(
      subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one')).kind,
      'silent',
      'agent_id is unique per subagent instance, so a second stop for one agent is the same agent stopping again'
    )
  })
})

test('hook.subagent-gate-asks-each-agent-separately', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-asks-each-agent-separately')
    startSession(rt, repo, SESSION_ID)

    subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one'))

    assert.equal(
      subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-two')).kind,
      'block',
      'a different agent holds different material and has not been asked'
    )
  })
})

test('hook.subagent-gate-is-silent-with-no-agent-id', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-is-silent-with-no-agent-id')
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, { ...subagentEventFor(repo, SESSION_ID, 'x'), agent_id: null })

    assert.equal(verdict.kind, 'silent', 'a payload the gate cannot key on fails open rather than firing blind')
  })
})

test('hook.subagent-gate-is-silent-once-a-record-reaches-the-ledger', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'subagent-gate-is-silent-once-a-record-reaches-the-ledger')
    startSession(rt, repo, SESSION_ID)

    assert.equal(subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one')).kind, 'block')

    commitSessionEntry(rt, repo, threadId, 'anything at all')

    assert.equal(
      subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-two')).kind,
      'silent',
      'the head moved off the reference once a write reached the ledger, so a fresh agent gets silence'
    )
  })
})

test('hook.subagent-gate-is-silent-on-an-agent-id-that-cannot-be-a-path-segment', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-agent-id-cannot-be-a-path-segment')
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, '../escape'))

    assert.equal(verdict.kind, 'silent')

    const layout = layoutFor(rt, repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return
    assert.equal(
      existsSync(join(layout.value.state, 'subagent-gate')),
      false,
      'a rejected agent_id must not create any marker directory'
    )
  })
})

test('hook.subagent-gate-is-silent-on-a-session-id-that-cannot-be-a-path-segment', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-session-id-cannot-be-a-path-segment')
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, {
      ...subagentEventFor(repo, SESSION_ID, 'agent-one'),
      session_id: '../escape'
    })

    assert.equal(verdict.kind, 'silent')

    const layout = layoutFor(rt, repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return
    assert.equal(
      existsSync(join(layout.value.state, 'subagent-gate')),
      false,
      'a rejected session_id must not create any marker directory'
    )
  })
})

test('hook.subagent-gate-is-silent-on-an-empty-agent-type', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-empty-agent-type')
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one', ''))

    assert.equal(verdict.kind, 'silent', 'an empty agent_type marks an internal fork, not a real subagent')

    const layout = layoutFor(rt, repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return
    assert.equal(
      existsSync(join(layout.value.state, 'subagent-gate')),
      false,
      'an internal fork must not create any marker directory'
    )
  })
})

test('hook.subagent-stop-process-does-not-block-when-agent-type-is-absent-from-payload', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-stop-process-agent-type-absent')
    startSession(rt, repo, SESSION_ID)

    const pluginDataRoot = rt.env.CLAUDE_PLUGIN_DATA
    assert.equal(typeof pluginDataRoot, 'string', 'the fixture runtime must carry a CLAUDE_PLUGIN_DATA path')
    if (typeof pluginDataRoot !== 'string') return

    const eventWithNoAgentType = { session_id: SESSION_ID, cwd: repo, agent_id: 'agent-one' }

    const result = runHookProcessWithEvent('subagent-stop', eventWithNoAgentType, {
      env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }
    })

    assert.equal(
      result.status,
      0,
      `expected the subagent-stop hook process to not block when agent_type is absent from the payload, got status ${String(result.status)} stderr: ${result.stderr}`
    )
  })
})
