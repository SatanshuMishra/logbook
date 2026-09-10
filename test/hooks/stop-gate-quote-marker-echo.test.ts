import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stopGateVerdict, type StopVerdict } from '../../src/hooklib/stop-gate.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-quote-marker-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const RESUME_TOOL_USE_ID = 'toolu_stop_gate_quote_marker'

const BRIEFING = [
  '# Your Preflight Briefing',
  '',
  '> Session goal: ship the export feature end to end',
  '> Last decision: keep the CSV format instead of switching to JSON',
  'The thread is currently blocked on a review from the platform team.',
  'Next step: land the CSV writer and open a follow-up thread for JSON.'
].join('\n')

const DROPPED_LINE = 'The thread is currently blocked on a review from the platform team.'

const stripLeadingQuoteMarkers = (briefing: string): string =>
  briefing
    .split('\n')
    .map((line) => (line.startsWith('> ') ? line.slice(2) : line))
    .join('\n')

const dropOneNonMarkerLine = (briefing: string): string =>
  briefing
    .split('\n')
    .filter((line) => line !== DROPPED_LINE)
    .join('\n')

const indentMarkerLinesByFourSpaces = (briefing: string): string =>
  briefing
    .split('\n')
    .map((line) => (line.startsWith('> ') ? `    ${line}` : line))
    .join('\n')

const dropMarkerTrailingSpace = (briefing: string): string =>
  briefing
    .split('\n')
    .map((line) => (line.startsWith('> ') ? `>${line.slice(2)}` : line))
    .join('\n')

const MARKER_LINE_WITH_INTACT_PREFIX = '> Session goal: ship the export feature end to end'

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

const writeTranscriptWithEchoedText = (transcriptPath: string, briefing: string, echoedText: string): void => {
  const lines = [
    toolUseEntry(RESUME_TOOL_USE_ID),
    toolResultEntry(RESUME_TOOL_USE_ID, JSON.stringify({ briefing })),
    assistantEntry([{ type: 'text', text: echoedText }])
  ]
  writeFileSync(transcriptPath, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

const runOneCase = (
  sessionId: string,
  echoedText: string,
  expectedKind: 'silent' | 'block',
  message: string
): StopVerdict =>
  withRepo((repo) =>
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
      const transcriptDir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-quote-marker-transcript-'))
      try {
        const transcriptPath = join(transcriptDir, 'transcript.jsonl')
        writeTranscriptWithEchoedText(transcriptPath, BRIEFING, echoedText)

        const verdict = stopGateVerdict(rt, {
          session_id: sessionId,
          cwd: repo,
          transcript_path: transcriptPath,
          stop_hook_active: false,
          prompt_id: null
        })
        assert.equal(verdict.kind, expectedKind, message)
        return verdict
      } finally {
        rmSync(transcriptDir, { recursive: true, force: true })
      }
    })
  )

test('hook.stop-gate-quote-marker-echo-exact-reproduction-is-silent', () => {
  runOneCase(
    'stop-gate-quote-marker-exact-session',
    BRIEFING,
    'silent',
    'an assistant text that reproduces the briefing byte-for-byte, blockquote markers included, must be silent'
  )
})

test('hook.stop-gate-quote-marker-echo-tolerates-stripped-blockquote-markers', () => {
  runOneCase(
    'stop-gate-quote-marker-stripped-session',
    stripLeadingQuoteMarkers(BRIEFING),
    'silent',
    'an assistant text that reproduces every line of the briefing but with the leading "> " blockquote marker removed carries no lost information and must still be silent; today the byte-exact comparison rejects it and blocks'
  )
})

test('hook.stop-gate-quote-marker-echo-still-blocks-on-dropped-content', () => {
  const verdict = runOneCase(
    'stop-gate-quote-marker-dropped-session',
    dropOneNonMarkerLine(BRIEFING),
    'block',
    'an assistant text that drops one whole non-marker line of the briefing is missing real content and must still block; tolerating a stripped marker must not widen into tolerating missing content'
  )
  if (verdict.kind !== 'block') return
  assert.ok(
    verdict.reason.includes(MARKER_LINE_WITH_INTACT_PREFIX),
    `the block reason must still carry the briefing's original, unnormalised text, including a "> " marker left intact, but that line was not found verbatim in: ${verdict.reason}`
  )
})

test('hook.stop-gate-quote-marker-echo-does-not-tolerate-a-four-space-indent-before-the-marker', () => {
  runOneCase(
    'stop-gate-quote-marker-four-space-indent-session',
    indentMarkerLinesByFourSpaces(BRIEFING),
    'block',
    'the normalisation tolerates at most three leading spaces before the "> " marker; four leading spaces is past that allowance, so the marker is not recognised, the line is not stripped, and the mismatch must still block'
  )
})

test('hook.stop-gate-quote-marker-echo-tolerates-a-marker-with-no-trailing-space', () => {
  runOneCase(
    'stop-gate-quote-marker-no-trailing-space-session',
    dropMarkerTrailingSpace(BRIEFING),
    'silent',
    'the normalisation treats the single space following the "> " marker as optional, not mandatory; a marker with no trailing space at all carries no lost information and must still be silent'
  )
})
