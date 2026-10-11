import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { ToolContext } from '../../src/server/register.ts'
import {
  commitOneThread,
  stopEventFor,
  withFixture,
  writeAgentTranscript,
  type AgentTranscriptEntry
} from '../support/stop-gate-fixture.ts'

const SESSION_ID = 'stop-gate-owes-only-a-pickup-session'
const THREAD_ID = '01M4KKVS4E22W2MS6CFAMZA4H9'
const STUB_TOOL_CTX = {} as unknown as ToolContext
const PROJECT_ROOT = join(import.meta.dirname, '..', '..')

const FULL_BRIEFING = [
  '# Your Preflight Briefing',
  '',
  '**Thread:** Spoken editing rebuild for voice-combobulator 0.1.0',
  '**Status:** open',
  '',
  '**Next step:**',
  '',
  '> Collect the eval-mac-fix-r1 build result.'
].join('\n')

const HEAD_BRIEFING = [
  '# Your Preflight Briefing',
  '',
  '**Thread:** Spoken editing rebuild for voice-combobulator 0.1.0',
  '**Criteria:** 0 of 9 done',
  '',
  '**Not shown:**',
  '- this session was already briefed on this thread, so only the head of the briefing is shown'
].join('\n')

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

const RESUME = 'mcp__plugin_logbook_ledger__resume_thread'
const PARK = 'mcp__plugin_logbook_ledger__park_thread'

const resumeReply = (briefing: string, pickup: boolean): string =>
  JSON.stringify(
    pickup
      ? { thread_id: THREAD_ID, briefing, previous_session: null, pickup: true }
      : { thread_id: THREAD_ID, briefing, previous_session: null }
  )

const pickupTurn = (promptId: string, callId: string, briefing: string, printed: string): AgentTranscriptEntry[] => [
  humanPrompt(promptId, `/logbook:preflight ${THREAD_ID}`),
  assistantCall(callId, RESUME, { thread_id: THREAD_ID, pickup: true }),
  toolResult(promptId, callId, resumeReply(briefing, true)),
  assistantText(printed)
]

const stopFor = (cwd: string, transcriptPath: string, promptId: string | null, stopHookActive = false) => ({
  ...stopEventFor(cwd, SESSION_ID, stopHookActive, promptId),
  transcript_path: transcriptPath
})

const loadStopGate = async () => (await import('../../src/hooklib/stop-gate.ts')).stopGateVerdict

test('hook.stop-gate-owes-nothing-for-a-briefing-the-agent-read-for-itself', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const transcriptPath = writeAgentTranscript(repo, 'debrief-reread', [
      humanPrompt('prompt-debrief', 'Debrief and park the thread.'),
      assistantCall('toolu_reread', RESUME, { thread_id: THREAD_ID, full_briefing: true }),
      toolResult('prompt-debrief', 'toolu_reread', resumeReply(FULL_BRIEFING, false)),
      assistantCall('toolu_park', PARK, { next_step: 'Ask what the manual test showed.', next_step_records: [] }),
      toolResult('prompt-debrief', 'toolu_park', JSON.stringify({ status: 'parked' })),
      assistantText('The thread is parked. I recorded five decisions and added seven risks.')
    ])

    const verdict = stopGateVerdict(rt, stopFor(repo, transcriptPath, 'prompt-debrief'))

    assert.equal(
      verdict.kind,
      'silent',
      `a debrief that re-read the briefing with full_briefing owes the human nothing, got: ${
        verdict.kind === 'block' ? verdict.reason.slice(0, 120) : verdict.kind
      }`
    )
  })
})

test('hook.stop-gate-owes-nothing-for-a-resume-taken-to-park', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const transcriptPath = writeAgentTranscript(repo, 'resume-to-park', [
      humanPrompt('prompt-park', 'Park the old thread too.'),
      assistantText('Logbook needs the thread marked as being worked before it can be parked, so I am resuming it first.'),
      assistantCall('toolu_retake', RESUME, { thread_id: THREAD_ID }),
      toolResult('prompt-park', 'toolu_retake', resumeReply(FULL_BRIEFING, false)),
      assistantCall('toolu_park', PARK, { next_step: 'Ask what the manual test showed.', next_step_records: [] }),
      toolResult('prompt-park', 'toolu_park', JSON.stringify({ status: 'parked' })),
      assistantText('Both threads are parked.')
    ])

    const verdict = stopGateVerdict(rt, stopFor(repo, transcriptPath, 'prompt-park'))

    assert.equal(verdict.kind, 'silent', 'a resume the agent took only to park the thread owes the human no briefing')
  })
})

test('hook.stop-gate-never-owes-a-briefing-from-an-earlier-turn', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const subdirectory = join(repo, '.evidence', 'live')
    mkdirSync(subdirectory, { recursive: true })
    const turnA = pickupTurn('prompt-a', 'toolu_pickup_a', FULL_BRIEFING, FULL_BRIEFING)
    const turnB: AgentTranscriptEntry[] = [
      humanPrompt('prompt-b', 'Record the merge and keep going.'),
      assistantCall('toolu_retake_b', RESUME, { thread_id: THREAD_ID }),
      toolResult('prompt-b', 'toolu_retake_b', resumeReply(HEAD_BRIEFING, false)),
      assistantText('Recorded; continuing the e2e run.')
    ]
    const turnC: AgentTranscriptEntry[] = [
      humanPrompt('prompt-c', 'Restart the e2e testing.'),
      assistantText('The e2e run restarted from the evidence folder.')
    ]

    const afterA = writeAgentTranscript(repo, 'earlier-turn', turnA)
    assert.equal(stopGateVerdict(rt, stopFor(repo, afterA, 'prompt-a')).kind, 'silent')
    const afterB = writeAgentTranscript(repo, 'earlier-turn', [...turnA, ...turnB])
    assert.equal(stopGateVerdict(rt, stopFor(repo, afterB, 'prompt-b')).kind, 'silent')
    const afterC = writeAgentTranscript(repo, 'earlier-turn', [...turnA, ...turnB, ...turnC])

    const later = stopGateVerdict(rt, stopFor(subdirectory, afterC, 'prompt-c'))

    assert.equal(
      later.kind,
      'silent',
      `a turn that resumed nothing owes no briefing, even after the session moved into a subfolder, got: ${
        later.kind === 'block' ? later.reason.slice(0, 120) : later.kind
      }`
    )
  })
})

test('hook.stop-gate-holds-every-pickup-turn-to-its-own-briefing', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const first = pickupTurn('prompt-first', 'toolu_pickup_first', FULL_BRIEFING, FULL_BRIEFING)
    const middle: AgentTranscriptEntry[] = [humanPrompt('prompt-middle', 'Carry on with the review.'), assistantText('Review done.')]
    const second = pickupTurn('prompt-second', 'toolu_pickup_second', HEAD_BRIEFING, 'Resumed the thread again; nothing new.')

    const afterFirst = writeAgentTranscript(repo, 'second-pickup', first)
    assert.equal(stopGateVerdict(rt, stopFor(repo, afterFirst, 'prompt-first')).kind, 'silent')
    const afterMiddle = writeAgentTranscript(repo, 'second-pickup', [...first, ...middle])
    assert.equal(stopGateVerdict(rt, stopFor(repo, afterMiddle, 'prompt-middle')).kind, 'silent')
    const afterSecond = writeAgentTranscript(repo, 'second-pickup', [...first, ...middle, ...second])

    const verdict = stopGateVerdict(rt, stopFor(repo, afterSecond, 'prompt-second'))

    assert.equal(verdict.kind, 'block', 'a second pickup the human asked for owes the head it returned')
    assert.ok(
      verdict.kind === 'block' && verdict.reason.endsWith(HEAD_BRIEFING),
      'the block carries the briefing that second pickup returned, not the first one'
    )
  })
})

test('hook.stop-gate-never-owes-an-unprinted-pickup-from-an-earlier-turn', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const transcriptPath = writeAgentTranscript(repo, 'unprinted-earlier-pickup', [
      ...pickupTurn('prompt-a', 'toolu_pickup_a', FULL_BRIEFING, 'Resumed the thread; the next step is the build result.'),
      humanPrompt('prompt-b', 'Merge the fix branch.'),
      assistantText('Merged.')
    ])

    const verdict = stopGateVerdict(rt, stopFor(repo, transcriptPath, 'prompt-b'))

    assert.equal(verdict.kind, 'silent', 'a briefing an earlier turn left unprinted is never demanded by a later turn')
  })
})

test('hook.stop-gate-owes-nothing-when-the-stop-carries-no-prompt-id', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const transcriptPath = writeAgentTranscript(
      repo,
      'no-prompt-id',
      pickupTurn('prompt-pickup', 'toolu_pickup', FULL_BRIEFING, 'Resumed the thread.')
    )

    const verdict = stopGateVerdict(rt, stopFor(repo, transcriptPath, null))

    assert.equal(verdict.kind, 'silent', 'without a prompt id no briefing can be tied to the stopping turn')
  })
})

test('hook.stop-gate-holds-a-repeat-pickup-to-its-own-print', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const first = pickupTurn('prompt-first', 'toolu_pickup_first', HEAD_BRIEFING, HEAD_BRIEFING)
    const again = pickupTurn('prompt-again', 'toolu_pickup_again', HEAD_BRIEFING, 'Same thread, nothing changed since the last pickup.')

    const afterFirst = writeAgentTranscript(repo, 'repeat-pickup', first)
    assert.equal(stopGateVerdict(rt, stopFor(repo, afterFirst, 'prompt-first')).kind, 'silent')
    const afterAgain = writeAgentTranscript(repo, 'repeat-pickup', [...first, ...again])

    const verdict = stopGateVerdict(rt, stopFor(repo, afterAgain, 'prompt-again'))

    assert.equal(verdict.kind, 'block', 'a pickup is printed in its own turn, even when an earlier turn printed the same text')
  })
})

test('hook.stop-gate-reads-an-unreadable-transcript-as-owing-nothing', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const directoryAsTranscript = join(repo, 'transcript-is-a-directory')
    mkdirSync(directoryAsTranscript)

    const verdict = stopGateVerdict(rt, stopFor(repo, directoryAsTranscript, 'prompt-any'))

    assert.equal(verdict.kind, 'silent', 'an unreadable transcript proves no debt and must not throw')
  })
})

test('hook.stop-gate-blocks-a-pickup-turn-that-did-not-print-its-briefing', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const transcriptPath = writeAgentTranscript(
      repo,
      'pickup-paraphrased',
      pickupTurn('prompt-pickup', 'toolu_pickup', FULL_BRIEFING, 'Resumed the spoken editing thread; next is the build result.')
    )

    const verdict = stopGateVerdict(rt, stopFor(repo, transcriptPath, 'prompt-pickup'))

    assert.equal(verdict.kind, 'block', 'a pickup the human asked for still owes its briefing word for word')
    assert.ok(verdict.kind === 'block' && verdict.reason.endsWith(FULL_BRIEFING), 'the block carries the owed briefing')
  })
})

test('hook.stop-gate-is-silent-on-a-pickup-turn-that-printed-its-briefing', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const quoteStripped = FULL_BRIEFING.replace('> Collect', 'Collect')
    const transcriptPath = writeAgentTranscript(
      repo,
      'pickup-printed',
      pickupTurn('prompt-pickup', 'toolu_pickup', FULL_BRIEFING, `Here is the briefing.\n\n${quoteStripped}`)
    )

    const verdict = stopGateVerdict(rt, stopFor(repo, transcriptPath, 'prompt-pickup'))

    assert.equal(verdict.kind, 'silent', 'a pickup whose briefing was printed word for word owes nothing more')
  })
})

test('hook.stop-gate-is-silent-on-the-stop-that-follows-a-verbatim-block', async () => {
  const stopGateVerdict = await loadStopGate()
  await withFixture(async ({ rt, repo }) => {
    const transcriptPath = writeAgentTranscript(
      repo,
      'pickup-after-block',
      pickupTurn('prompt-pickup', 'toolu_pickup', FULL_BRIEFING, 'Resumed the thread.')
    )

    const verdict = stopGateVerdict(rt, stopFor(repo, transcriptPath, 'prompt-pickup', true))

    assert.equal(verdict.kind, 'silent', 'the stop hook never blocks twice in a row')
  })
})

test('resume.a-pickup-says-so-in-its-reply', async () => {
  const { resumeThreadTool } = await import('../../src/server/tools/resume_thread.ts')
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-reply')
    const parsed = resumeThreadTool.input.safeParse({ thread_id: threadId, pickup: true })
    assert.equal(parsed.success, true, 'resume_thread accepts pickup')

    const pickupRt = { ...rt, sessionId: SESSION_ID }
    const picked = await resumeThreadTool.handler(pickupRt, STUB_TOOL_CTX, { thread_id: threadId, pickup: true } as never)
    assert.equal(picked.ok, true)
    assert.equal(picked.ok && (picked.structured as Record<string, unknown>).pickup, true, 'a pickup reply says pickup: true')

    const retaken = await resumeThreadTool.handler(pickupRt, STUB_TOOL_CTX, { thread_id: threadId })
    assert.equal(retaken.ok, true)
    assert.equal(
      retaken.ok && Object.hasOwn(retaken.structured as Record<string, unknown>, 'pickup'),
      false,
      'a resume that did not say pickup carries no pickup field'
    )
  })
})

test('resume.a-pickup-renders-and-records-exactly-as-a-plain-resume', async () => {
  const { resumeThreadTool } = await import('../../src/server/tools/resume_thread.ts')
  const briefingOf = (reply: Awaited<ReturnType<typeof resumeThreadTool.handler>>): string => {
    assert.equal(reply.ok, true)
    return reply.ok ? String((reply.structured as Record<string, unknown>).briefing) : ''
  }
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'pickup-same-briefing')
    const plainRt = { ...rt, sessionId: 'plain-session' }
    const firstPlain = briefingOf(await resumeThreadTool.handler(plainRt, STUB_TOOL_CTX, { thread_id: threadId }))
    const secondPlain = briefingOf(await resumeThreadTool.handler(plainRt, STUB_TOOL_CTX, { thread_id: threadId }))
    const pickupAfterBriefed = briefingOf(
      await resumeThreadTool.handler(plainRt, STUB_TOOL_CTX, { thread_id: threadId, pickup: true } as never)
    )
    assert.notEqual(firstPlain, secondPlain, 'the fixture shows the full briefing first and the head after')
    assert.equal(pickupAfterBriefed, secondPlain, 'a pickup in a briefed session gets the same head a plain resume gets')

    const pickupRt = { ...rt, sessionId: 'pickup-session' }
    const firstPickup = briefingOf(
      await resumeThreadTool.handler(pickupRt, STUB_TOOL_CTX, { thread_id: threadId, pickup: true } as never)
    )
    const plainAfterPickup = briefingOf(await resumeThreadTool.handler(pickupRt, STUB_TOOL_CTX, { thread_id: threadId }))
    assert.equal(firstPickup, firstPlain, 'a first pickup renders the same full briefing a first plain resume renders')
    assert.equal(plainAfterPickup, secondPlain, 'a pickup records the session as briefed exactly as a plain resume does')
  })
})

const resumeStepOf = (skill: string): string => {
  const text = readFileSync(join(PROJECT_ROOT, 'skills', skill, 'SKILL.md'), 'utf8')
  const step = text.split('\n').find((line) => /^\d+\.\s+Call `resume_thread`/.test(line))
  assert.ok(step !== undefined, `skills/${skill}/SKILL.md has a step that calls resume_thread`)
  return step
}

test('skill.preflight-and-file-mark-their-resume-as-the-pickup', () => {
  for (const skill of ['preflight', 'file']) {
    assert.match(resumeStepOf(skill), /`resume_thread\.pickup` set to true/, `skills/${skill} marks its resume as the pickup`)
  }
  const debrief = readFileSync(join(PROJECT_ROOT, 'skills', 'debrief', 'SKILL.md'), 'utf8')
  assert.equal(debrief.includes('resume_thread.pickup'), false, 'the debrief never claims a pickup')
})

test('prompt.preflight-asks-for-a-pickup-resume', async () => {
  const { registerPrompts } = await import('../../src/server/prompts.ts')
  const home = mkdtempSync(join(tmpdir(), 'logbook-pickup-prompt-'))
  try {
    const { testRuntime } = await import('../support/runtime.ts')
    const rt = testRuntime({ env: { HOME: home, CLAUDE_PLUGIN_DATA: join(home, 'data') }, cwd: home })
    const server = new McpServer({ name: 'pickup-prompt', version: '0.0.0' })
    registerPrompts(server, rt)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'pickup-prompt-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      for (const args of [{}, { thread: THREAD_ID }]) {
        const prompt = await client.getPrompt({ name: 'preflight', arguments: args })
        const text = prompt.messages.map((message) => (message.content.type === 'text' ? message.content.text : '')).join('\n')
        assert.match(text, /pickup/, `the preflight prompt with ${JSON.stringify(args)} asks for a pickup resume`)
      }
    } finally {
      await client.close()
      await server.close()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
