import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-latch-order-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const RESUME_TOOL_USE_ID = 'toolu_stop_gate_latch_order'

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

const toolUseEntry = (toolUseId: string): Record<string, unknown> =>
  assistantEntry([{ type: 'tool_use', id: toolUseId, name: 'mcp__ledger__resume_thread', input: {} }])

const writeJsonlTranscript = (transcriptPath: string, entries: Record<string, unknown>[]): void => {
  writeFileSync(transcriptPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

const writeTranscriptWithNoResumeResult = (transcriptPath: string): void => {
  writeJsonlTranscript(transcriptPath, [
    assistantEntry([{ type: 'text', text: 'unrelated assistant chatter with no resume tool call in it' }])
  ])
}

const writeTranscriptWithUnpaidResumeDebt = (transcriptPath: string, briefing: string): void => {
  writeJsonlTranscript(transcriptPath, [
    toolUseEntry(RESUME_TOOL_USE_ID),
    toolResultEntry(RESUME_TOOL_USE_ID, JSON.stringify({ briefing }))
  ])
}

const writeTranscriptWithPaidResumeDebt = (transcriptPath: string, briefing: string): void => {
  writeJsonlTranscript(transcriptPath, [
    toolUseEntry(RESUME_TOOL_USE_ID),
    toolResultEntry(RESUME_TOOL_USE_ID, JSON.stringify({ briefing })),
    assistantEntry([{ type: 'text', text: briefing }])
  ])
}

test('hook.stop-gate-latch-does-not-permanently-exempt-a-session-that-once-had-nothing-to-examine', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
      const transcriptDir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-latch-order-transcript-'))
      try {
        const transcriptPath = join(transcriptDir, 'transcript.jsonl')
        const briefing = '# Your Preflight Briefing\n\nsome briefing text unique to stop-gate-latch-order'

        writeTranscriptWithNoResumeResult(transcriptPath)

        const nothingToExamineVerdict = stopGateVerdict(rt, {
          session_id: 'stop-gate-latch-order-session-a',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(
          nothingToExamineVerdict.kind,
          'silent',
          'a stop event whose transcript carries no resume_thread result at all must be silent, since there is nothing yet to check'
        )

        writeTranscriptWithUnpaidResumeDebt(transcriptPath, briefing)

        const sameSessionNowFacingRealDebtVerdict = stopGateVerdict(rt, {
          session_id: 'stop-gate-latch-order-session-a',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(
          sameSessionNowFacingRealDebtVerdict.kind,
          'block',
          'a session that latched as checked while there was nothing to examine is never checked again: the transcript now carries a real, unpaid resume briefing debt, but this session was exempted forever by the earlier no-op check'
        )

        const freshSessionReadingTheSameDebtVerdict = stopGateVerdict(rt, {
          session_id: 'stop-gate-latch-order-session-b',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(
          freshSessionReadingTheSameDebtVerdict.kind,
          'block',
          'a fresh session id reading the identical transcript must be blocked, which is the control proving the transcript really does carry an unpaid debt and the prior silent verdict was a false exemption rather than a correct reading'
        )
      } finally {
        rmSync(transcriptDir, { recursive: true, force: true })
      }
    })
  })
})

test('hook.stop-gate-blocks-a-session-at-most-once-then-a-fresh-session-proves-the-debt-still-unpaid', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
      const transcriptDir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-latch-order-once-per-session-'))
      try {
        const transcriptPath = join(transcriptDir, 'transcript.jsonl')
        const briefing = '# Your Preflight Briefing\n\nsome briefing text unique to the once-per-session control'
        writeTranscriptWithUnpaidResumeDebt(transcriptPath, briefing)

        const firstStopForSessionA = stopGateVerdict(rt, {
          session_id: 'stop-gate-latch-order-once-per-session-a',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(
          firstStopForSessionA.kind,
          'block',
          'the first stop event for a session facing a real unpaid resume debt must block'
        )

        const secondStopForSameSessionA = stopGateVerdict(rt, {
          session_id: 'stop-gate-latch-order-once-per-session-a',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(
          secondStopForSameSessionA.kind,
          'silent',
          'a second stop event carrying the SAME session id that already blocked once must be silent, or an unpaid debt would block that session on every turn forever'
        )

        const thirdStopForFreshSessionB = stopGateVerdict(rt, {
          session_id: 'stop-gate-latch-order-once-per-session-b',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(
          thirdStopForFreshSessionB.kind,
          'block',
          'a FRESH session id reading the identical transcript must block again: this is the control proving the debt is still genuinely unpaid and the prior silent verdict was a per-session latch, not the debt having been paid'
        )
      } finally {
        rmSync(transcriptDir, { recursive: true, force: true })
      }
    })
  })
})

test('hook.stop-gate-latch-stays-silent-once-a-resume-debt-was-already-paid-in-full', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
      const transcriptDir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-latch-order-paid-transcript-'))
      try {
        const transcriptPath = join(transcriptDir, 'transcript.jsonl')
        const briefing = '# Your Preflight Briefing\n\nsome other briefing text unique to the paid-debt control'
        writeTranscriptWithPaidResumeDebt(transcriptPath, briefing)

        const verdict = stopGateVerdict(rt, {
          session_id: 'stop-gate-latch-order-session-paid',
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(
          verdict.kind,
          'silent',
          'a fresh session reading a transcript whose briefing was already echoed verbatim must be silent; a fix that blocks more broadly to close the latch defect must not break this genuinely paid debt'
        )
      } finally {
        rmSync(transcriptDir, { recursive: true, force: true })
      }
    })
  })
})
