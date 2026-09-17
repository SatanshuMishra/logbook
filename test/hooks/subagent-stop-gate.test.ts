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
  ledgerCallEntries,
  startSession,
  subagentEventFor,
  withFixture,
  writeAgentTranscript
} from '../support/stop-gate-fixture.ts'

const SESSION_ID = 'subagent-stop-gate-session'

test('hook.subagent-gate-asks-plainly-for-decisions-risks-and-findings', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-asks-plainly')
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind !== 'block') return
    assert.ok(
      verdict.reason.startsWith(
        'Logbook: this agent has not recorded a decision, risk, thread change or session entry in this run.'
      )
    )
    assert.ok(verdict.reason.includes('each decision made, with its reason, using record_decision'))
    assert.ok(verdict.reason.includes('each risk found, using update_thread with risks_add'))
    assert.ok(verdict.reason.includes('using log_session_event'))
    assert.ok(verdict.reason.includes('list_threads'))
    assert.ok(
      verdict.reason.includes('return as planned without writing'),
      'an agent with nothing to keep, no ledger tools, or a brief that forbids ledger writes must be told it may return'
    )
  })
})

test('hook.subagent-gate-is-silent-for-an-agent-that-stored-a-record', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-agent-recorded')
    startSession(rt, repo, SESSION_ID)
    const transcript = writeAgentTranscript(repo, 'agent-recorded', [
      ...ledgerCallEntries('toolu_list', 'list_threads', 'stored'),
      ...ledgerCallEntries('toolu_decision', 'record_decision', 'stored')
    ])

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one', 'Explore', transcript))

    assert.equal(verdict.kind, 'silent', 'an agent whose own record_decision call was stored has already recorded')
  })
})

for (const tool of ['open_thread', 'update_thread', 'close_thread', 'amend_criteria', 'park_thread', 'log_session_event']) {
  test(`hook.subagent-gate-counts-a-stored-${tool}-as-a-record`, async () => {
    await withFixture(async ({ rt, repo }) => {
      commitOneThread(rt, repo, 'subagent-gate-recording-tools')
      startSession(rt, repo, SESSION_ID)
      const transcript = writeAgentTranscript(repo, `agent-${tool}`, ledgerCallEntries('toolu_write', tool, 'stored'))

      const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one', 'Explore', transcript))

      assert.equal(verdict.kind, 'silent')
    })
  })
}

test('hook.subagent-gate-asks-an-agent-whose-only-write-was-refused', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-refused-write')
    startSession(rt, repo, SESSION_ID)
    const transcript = writeAgentTranscript(
      repo,
      'agent-refused',
      ledgerCallEntries('toolu_refused', 'log_session_event', 'refused')
    )

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one', 'Explore', transcript))

    assert.equal(verdict.kind, 'block', 'a refused call stored nothing, so the record is still missing')
  })
})

test('hook.subagent-gate-asks-an-agent-whose-recording-call-was-refused-beside-a-stored-read', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-refused-beside-read')
    startSession(rt, repo, SESSION_ID)
    const transcript = writeAgentTranscript(repo, 'agent-read-then-refused', [
      ...ledgerCallEntries('toolu_list', 'list_threads', 'stored'),
      ...ledgerCallEntries('toolu_decision', 'record_decision', 'refused')
    ])

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one', 'Explore', transcript))

    assert.equal(verdict.kind, 'block', 'only a stored result on the recording call itself counts as a record')
  })
})

test('hook.subagent-gate-counts-a-stored-record-under-the-project-scope-tool-prefix', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-project-scope-prefix')
    startSession(rt, repo, SESSION_ID)
    const transcript = writeAgentTranscript(
      repo,
      'agent-project-scope',
      ledgerCallEntries('toolu_decision', 'record_decision', 'stored', 'mcp__ledger__')
    )

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one', 'Explore', transcript))

    assert.equal(verdict.kind, 'silent')
  })
})

for (const [label, agentStored, expectedStatus] of [
  ['is-silent-when-only-the-agent-recorded', true, 0],
  ['blocks-when-only-the-parent-recorded', false, 2]
] as const) {
  test(`hook.subagent-stop-process-reads-the-agent-transcript-and-${label}`, async () => {
    await withFixture(async ({ rt, repo }) => {
      commitOneThread(rt, repo, 'subagent-stop-process-transcript-field')
      startSession(rt, repo, SESSION_ID)
      const pluginDataRoot = rt.env.CLAUDE_PLUGIN_DATA
      assert.equal(typeof pluginDataRoot, 'string', 'the fixture runtime must carry a CLAUDE_PLUGIN_DATA path')
      if (typeof pluginDataRoot !== 'string') return
      const stored = ledgerCallEntries('toolu_decision', 'record_decision', 'stored')
      const agentTranscript = writeAgentTranscript(repo, 'agent-own-transcript', agentStored ? stored : [])
      const parentTranscript = writeAgentTranscript(repo, 'parent-session-transcript', agentStored ? [] : stored)

      const result = runHookProcessWithEvent(
        'subagent-stop',
        {
          session_id: SESSION_ID,
          cwd: repo,
          agent_id: 'agent-one',
          agent_type: 'Explore',
          transcript_path: parentTranscript,
          agent_transcript_path: agentTranscript
        },
        { env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } }
      )

      assert.equal(result.status, expectedStatus, `the hook must judge the agent by its own transcript: ${result.stderr}`)
    })
  })
}

test('hook.subagent-gate-asks-an-agent-that-only-read-the-ledger', async () => {
  await withFixture(async ({ rt, repo }) => {
    commitOneThread(rt, repo, 'subagent-gate-read-only-ledger')
    startSession(rt, repo, SESSION_ID)
    const transcript = writeAgentTranscript(repo, 'agent-reader', [
      ...ledgerCallEntries('toolu_list', 'list_threads', 'stored'),
      ...ledgerCallEntries('toolu_resume', 'resume_thread', 'stored'),
      ...ledgerCallEntries('toolu_sync', 'sync_ledger', 'stored'),
      ...ledgerCallEntries('toolu_bind', 'bind_branch', 'stored')
    ])

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one', 'Explore', transcript))

    assert.equal(verdict.kind, 'block', 'reading, syncing or binding a branch records no finding')
  })
})

for (const [label, transcriptPath] of [
  ['absent', undefined],
  ['empty', ''],
  ['missing-file', 'no-such-agent-transcript.jsonl']
] as const) {
  test(`hook.subagent-gate-is-silent-when-the-agent-transcript-is-${label}`, async () => {
    await withFixture(async ({ rt, repo }) => {
      commitOneThread(rt, repo, 'subagent-gate-unreadable-transcript')
      startSession(rt, repo, SESSION_ID)
      const path = transcriptPath === 'no-such-agent-transcript.jsonl' ? join(repo, transcriptPath) : transcriptPath

      const verdict = subagentStopGateVerdict(rt, {
        ...subagentEventFor(repo, SESSION_ID, 'agent-one'),
        agent_transcript_path: path
      })

      assert.equal(verdict.kind, 'silent', 'the gate cannot tell that the record is missing, so it must not claim it is')
      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      assert.equal(
        existsSync(join(layout.value.state, 'subagent-gate', SESSION_ID, 'agent-one')),
        false,
        'a silent verdict must not spend the agent\'s one firing'
      )
    })
  })
}

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

test('hook.subagent-gate-asks-a-later-agent-even-after-a-record-reached-the-ledger', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'subagent-gate-asks-later-agent-after-record-reaches-ledger')
    startSession(rt, repo, SESSION_ID)

    assert.equal(subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one')).kind, 'block')

    commitSessionEntry(rt, repo, threadId, 'anything at all')

    assert.equal(
      subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-two')).kind,
      'block',
      'agent-one recording says nothing about the material agent-two holds'
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
