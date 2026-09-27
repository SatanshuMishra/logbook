import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import {
  commitOneThread,
  commitSessionEntry,
  resumeAs,
  startSession,
  stopEventFor,
  withFixture,
  writeAgentTranscript,
  type AgentTranscriptEntry
} from '../support/stop-gate-fixture.ts'

const SESSION_ID = 'stop-gate-pickup-turn-session'
const PICKUP_PROMPT = 'prompt-pickup'
const NEXT_PROMPT = 'prompt-after-pickup'
const RESUME_CALL_ID = 'toolu_stop_gate_pickup_resume'

const BRIEFING = ['# Your Preflight Briefing', '', 'Next step: wait for the human to name what to test.'].join('\n')

const humanPrompt = (promptId: string, text: string): AgentTranscriptEntry => ({
  type: 'user',
  promptId,
  message: { role: 'user', content: text }
})

const assistantCall = (id: string, name: string, input: Record<string, unknown>): AgentTranscriptEntry => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
})

const toolResult = (promptId: string, toolUseId: string, text: string): AgentTranscriptEntry => ({
  type: 'user',
  promptId,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }] }] }
})

const assistantText = (text: string): AgentTranscriptEntry => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] }
})

const pickupTurn = (threadId: string): AgentTranscriptEntry[] => [
  humanPrompt(PICKUP_PROMPT, `/logbook:preflight ${threadId}`),
  assistantCall(RESUME_CALL_ID, 'mcp__plugin_logbook_ledger__resume_thread', { thread_id: threadId }),
  toolResult(PICKUP_PROMPT, RESUME_CALL_ID, JSON.stringify({ briefing: BRIEFING })),
  assistantText(BRIEFING)
]

const overflowedPickupTurn = (threadId: string): AgentTranscriptEntry[] => [
  humanPrompt(PICKUP_PROMPT, '1'),
  assistantCall(RESUME_CALL_ID, 'mcp__plugin_logbook_ledger__resume_thread', { thread_id: threadId }),
  toolResult(
    PICKUP_PROMPT,
    RESUME_CALL_ID,
    'Error: result (146,933 characters) exceeds maximum allowed tokens. Output has been saved to /tmp/resume_thread-output.txt'
  ),
  assistantCall('toolu_stop_gate_pickup_read', 'Read', { file_path: '/tmp/resume_thread-output.txt' }),
  toolResult(PICKUP_PROMPT, 'toolu_stop_gate_pickup_read', BRIEFING),
  assistantCall('toolu_stop_gate_pickup_bash', 'Bash', { command: 'wc -c /tmp/resume_thread-output.txt' }),
  toolResult(PICKUP_PROMPT, 'toolu_stop_gate_pickup_bash', '146037 /tmp/resume_thread-output.txt'),
  assistantText(`The briefing is too long to print in full.\n\n${BRIEFING}`)
]

const pickupStop = (repo: string, transcriptPath: string, promptId: string) => ({
  ...stopEventFor(repo, SESSION_ID, false, promptId),
  transcript_path: transcriptPath
})

test('hook.stop-gate-is-silent-on-the-turn-that-only-picked-the-thread-up', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-only')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    const transcriptPath = writeAgentTranscript(repo, 'pickup-only-transcript', pickupTurn(threadId))

    const verdict = stopGateVerdict(rt, pickupStop(repo, transcriptPath, PICKUP_PROMPT))

    assert.equal(
      verdict.kind,
      'silent',
      `the stop that ends the turn which resumed the thread has nothing new to record, got: ${
        verdict.kind === 'block' ? verdict.reason : verdict.kind
      }`
    )
  })
})

test('hook.stop-gate-is-silent-on-a-pickup-turn-that-read-an-overflowed-briefing', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-overflowed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    const transcriptPath = writeAgentTranscript(repo, 'pickup-overflowed-transcript', overflowedPickupTurn(threadId))

    const verdict = stopGateVerdict(rt, pickupStop(repo, transcriptPath, PICKUP_PROMPT))

    assert.equal(
      verdict.kind,
      'silent',
      'the 2026-09-26 session resumed, read the saved oversized briefing with Read and Bash, and was still blocked'
    )
  })
})

test('hook.stop-gate-still-blocks-the-turn-after-a-silent-pickup-when-nothing-was-recorded', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-then-work')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    const transcriptPath = writeAgentTranscript(repo, 'pickup-then-work-transcript', [
      ...pickupTurn(threadId),
      humanPrompt(NEXT_PROMPT, 'run the limit tests'),
      assistantCall('toolu_stop_gate_next_bash', 'Bash', { command: 'npm test' }),
      toolResult(NEXT_PROMPT, 'toolu_stop_gate_next_bash', 'ok'),
      assistantText('The limit tests pass.')
    ])

    assert.equal(stopGateVerdict(rt, pickupStop(repo, transcriptPath, PICKUP_PROMPT)).kind, 'silent')

    const next = stopGateVerdict(rt, pickupStop(repo, transcriptPath, NEXT_PROMPT))

    assert.equal(next.kind, 'block', 'the turn after the pickup did work and recorded nothing')
    if (next.kind === 'block') {
      assert.ok(
        next.reason.startsWith("Logbook: nothing has reached this project's ledger"),
        `the reference stays at session start, so the untouched message fires, got: ${next.reason}`
      )
    }
  })
})

test('hook.stop-gate-is-silent-on-a-pickup-turn-when-only-another-thread-moved', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-other-thread')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    commitOneThread(rt, repo, 'another-thread-written-this-turn')
    const transcriptPath = writeAgentTranscript(repo, 'pickup-other-thread-transcript', [
      ...pickupTurn(threadId),
      humanPrompt(NEXT_PROMPT, 'carry on'),
      assistantText('Carrying on.')
    ])

    assert.equal(
      stopGateVerdict(rt, pickupStop(repo, transcriptPath, PICKUP_PROMPT)).kind,
      'silent',
      'a pickup turn is silent in the changed-only-on-other-threads branch as well as the unchanged branch'
    )

    const next = stopGateVerdict(rt, pickupStop(repo, transcriptPath, NEXT_PROMPT))

    assert.equal(next.kind, 'block', 'the turn after the pickup recorded nothing on the held thread')
    if (next.kind === 'block') {
      assert.ok(
        next.reason.startsWith("Logbook: records have reached this project's ledger, but none of them is filed under thread"),
        `the other thread's write is still in the diff, so the mismatch message fires, got: ${next.reason}`
      )
    }
  })
})

test('hook.stop-gate-a-pickup-turn-that-recorded-on-the-held-thread-still-moves-the-reference', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-recorded')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    commitSessionEntry(rt, repo, threadId, 'picked up and noted one environment fact')
    const transcriptPath = writeAgentTranscript(repo, 'pickup-recorded-transcript', [
      ...pickupTurn(threadId),
      humanPrompt(NEXT_PROMPT, 'run the limit tests'),
      assistantText('The limit tests pass.')
    ])

    assert.equal(stopGateVerdict(rt, pickupStop(repo, transcriptPath, PICKUP_PROMPT)).kind, 'silent')

    assert.equal(
      stopGateVerdict(rt, pickupStop(repo, transcriptPath, NEXT_PROMPT)).kind,
      'block',
      'the pickup turn wrote to the held thread, so the gate must advance its reference past that write; a following turn that records nothing is judged on its own'
    )
  })
})

test('hook.stop-gate-still-blocks-a-pickup-turn-when-the-client-sends-no-prompt-id', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-no-prompt-id')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    const transcriptPath = writeAgentTranscript(repo, 'pickup-no-prompt-id-transcript', pickupTurn(threadId))

    assert.equal(
      stopGateVerdict(rt, { ...stopEventFor(repo, SESSION_ID, false, null), transcript_path: transcriptPath }).kind,
      'block',
      'without a prompt id the stopping turn cannot be tied to the resume, so the gate behaves as it did before'
    )
  })
})

test('hook.stop-gate-still-blocks-a-turn-whose-only-resume-result-was-refused', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-refused')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    const transcriptPath = writeAgentTranscript(repo, 'pickup-refused-transcript', [
      humanPrompt(PICKUP_PROMPT, '/logbook:preflight 01ARZ3NDEK0000000000000099'),
      assistantCall(RESUME_CALL_ID, 'mcp__plugin_logbook_ledger__resume_thread', { thread_id: '01ARZ3NDEK0000000000000099' }),
      {
        type: 'user',
        promptId: PICKUP_PROMPT,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: RESUME_CALL_ID,
              is_error: true,
              content: [{ type: 'text', text: 'thread_id: no thread has this id' }]
            }
          ]
        }
      },
      assistantText('That thread does not exist.')
    ])

    assert.equal(
      stopGateVerdict(rt, pickupStop(repo, transcriptPath, PICKUP_PROMPT)).kind,
      'block',
      'a resume the server refused picked nothing up, so the turn is judged as today'
    )
  })
})

test('hook.stop-gate-treats-an-unreadable-transcript-as-no-pickup', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-unreadable')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)
    const transcriptPath = writeAgentTranscript(repo, 'pickup-unreadable-transcript', pickupTurn(threadId))

    assert.equal(
      stopGateVerdict(rt, pickupStop(repo, transcriptPath, NEXT_PROMPT)).kind,
      'block',
      'a stop whose prompt id is not the pickup turn is judged as today, and it latches the verbatim check for this session'
    )

    assert.equal(
      stopGateVerdict(rt, pickupStop(repo, repo, 'prompt-with-a-directory-for-a-transcript')).kind,
      'block',
      'a transcript path that cannot be read as a file must neither throw nor exempt the turn'
    )
  })
})
