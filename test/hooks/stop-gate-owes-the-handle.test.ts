import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { renderHandle } from '../../src/render/briefing.ts'
import type { Thread } from '../../src/schema/thread.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const rt = testRuntime()

const RESUME_TOOL_USE_ID = 'toolu_stop_gate_owes_the_handle'
const PICKUP_PROMPT_ID = 'prompt-stop-gate-owes-the-handle'

const handleThread = (): Thread => ({
  id: rt.ulid(),
  slug: 'stop-gate-owes-the-handle',
  title: 'Handle Debt Fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'prove the gate owes the head of a briefing',
    next_step: 'echo the head verbatim',
    landed: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const assistantEntry = (content: Record<string, unknown>[]): Record<string, unknown> => ({
  type: 'assistant',
  message: { role: 'assistant', content }
})

const toolResultEntry = (toolUseId: string, resultText: string): Record<string, unknown> => ({
  type: 'user',
  promptId: PICKUP_PROMPT_ID,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: resultText }] }
})

const toolUseEntry = (toolUseId: string, threadId: string): Record<string, unknown> =>
  assistantEntry([
    { type: 'tool_use', id: toolUseId, name: 'mcp__ledger__resume_thread', input: { thread_id: threadId, pickup: true } }
  ])

const pickupReply = (threadId: string, briefing: string): string =>
  JSON.stringify({ thread_id: threadId, briefing, previous_session: null, pickup: true })

const writeTranscript = (transcriptPath: string, entries: Record<string, unknown>[]): void => {
  writeFileSync(transcriptPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-owes-the-handle-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const withTranscript = <T>(fn: (transcriptPath: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-owes-the-handle-transcript-'))
  try {
    return fn(join(dir, 'transcript.jsonl'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('hook.stop-gate-owes-the-head-of-a-briefing-exactly-as-it-owes-the-whole-one', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      withTranscript((transcriptPath) => {
        const runtime = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
        const thread = handleThread()
        const handle = renderHandle(thread, { resolved: 0, dangling: [], quarantined: [] }, null, 0)

        writeTranscript(transcriptPath, [
          toolUseEntry(RESUME_TOOL_USE_ID, thread.id),
          toolResultEntry(RESUME_TOOL_USE_ID, pickupReply(thread.id, handle))
        ])

        const unpaid = stopGateVerdict(runtime, {
          session_id: 'stop-gate-owes-the-handle-unpaid',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: PICKUP_PROMPT_ID
        })
        assert.equal(unpaid.kind, 'block', 'a head returned by resume_thread and never echoed must block the turn')
        assert.ok(
          unpaid.kind === 'block' && unpaid.reason.includes(handle),
          'the block must carry the head the session owes'
        )

        writeTranscript(transcriptPath, [
          toolUseEntry(RESUME_TOOL_USE_ID, thread.id),
          toolResultEntry(RESUME_TOOL_USE_ID, pickupReply(thread.id, handle)),
          assistantEntry([{ type: 'text', text: handle }])
        ])

        const paid = stopGateVerdict(runtime, {
          session_id: 'stop-gate-owes-the-handle-paid',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: PICKUP_PROMPT_ID
        })
        assert.equal(paid.kind, 'silent', 'a head echoed verbatim must pay the debt exactly as a whole briefing does')
      })
    })
  })
})
