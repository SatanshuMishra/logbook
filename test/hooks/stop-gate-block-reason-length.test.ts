import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { controlledEnv, freshPluginDataDir, freshTmpDir, runHookProcess } from './hook-process.ts'
import { BRIEFING_MAX_CHARS } from '../../src/render/briefing.ts'

const RESUME_TOOL_USE_ID = 'toolu_stop_gate_block_reason_length'
const FINAL_LINE = 'FINAL-LINE-MARKER-2f8a6c1e9d3b47a0a5c0e1f9d2b6c7a4'
const BRIEFING_SEPARATOR_CHARS = 1
const FILLER_LINE_LENGTH = BRIEFING_MAX_CHARS - FINAL_LINE.length - BRIEFING_SEPARATOR_CHARS

const assistantEntry = (content: Record<string, unknown>[]): Record<string, unknown> => ({
  type: 'assistant',
  message: { role: 'assistant', content }
})

const toolResultEntry = (toolUseId: string, resultText: string): Record<string, unknown> => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content: resultText }]
  }
})

const buildOversizedBriefing = (): string => `${'a'.repeat(FILLER_LINE_LENGTH)}\n${FINAL_LINE}`

const writeUnechoedResumeTranscript = (transcriptPath: string, briefing: string): void => {
  const lines = [
    assistantEntry([{ type: 'tool_use', id: RESUME_TOOL_USE_ID, name: 'mcp__ledger__resume_thread', input: {} }]),
    toolResultEntry(RESUME_TOOL_USE_ID, JSON.stringify({ briefing }))
  ]
  writeFileSync(transcriptPath, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

test('hook.stop-gate-block-message-carries-the-briefing-to-its-final-line', () => {
  const home = freshTmpDir('logbook-stop-block-reason-home-')
  const { home: dataHome, root: data } = freshPluginDataDir('logbook-stop-block-reason-data-')
  const cwd = freshTmpDir('logbook-stop-block-reason-cwd-')
  const transcriptDir = mkdtempSync(join(tmpdir(), 'logbook-stop-block-reason-transcript-'))
  try {
    const briefing = buildOversizedBriefing()
    assert.ok(briefing.length > 10000, 'the fixture briefing must itself exceed the field clip so the test binds anything')

    const transcriptPath = join(transcriptDir, 'transcript.jsonl')
    writeUnechoedResumeTranscript(transcriptPath, briefing)

    const event = {
      session_id: 'stop-gate-block-reason-length-session',
      cwd,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      prompt_id: null
    }

    const result = runHookProcess('stop', JSON.stringify(event), {
      env: controlledEnv({ HOME: home, CLAUDE_PLUGIN_DATA: data })
    })

    assert.equal(result.status, 2, `expected the stop hook to block on an unechoed briefing, stderr: ${result.stderr}`)
    assert.ok(
      result.stderr.includes(FINAL_LINE),
      `expected the emitted block message to contain the briefing's final line, but it was clipped before reaching it; last 200 chars of stderr: ${result.stderr.slice(-200)}`
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(dataHome, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
    rmSync(transcriptDir, { recursive: true, force: true })
  }
})
