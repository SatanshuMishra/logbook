import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { toolOk } from '../../src/server/errors.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import {
  resumePayloadBytes,
  PREVIOUS_SESSION_NULL_BYTES,
  PREVIOUS_SESSION_LARGEST_BYTES
} from '../../src/render/briefing.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const FIRST_SESSION = 'resume-payload-single-copy-session-one'
const SECOND_SESSION = 'resume-payload-single-copy-session-two'

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

const PREDICTED_OVER_ACTUAL_TOLERANCE_BYTES = PREVIOUS_SESSION_LARGEST_BYTES - PREVIOUS_SESSION_NULL_BYTES

type Harness = { runtimeFor: (sessionId: string) => Runtime }

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'logbook resume payload single-copy fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Resume Payload Single Copy Fixture'],
    ['config', 'user.email', 'resume-payload-single-copy@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`resume payload single-copy fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (fn: (harness: Harness) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-resume-payload-single-copy-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-resume-payload-single-copy-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  try {
    setUpRepo(repo)
    const runtimeFor = (sessionId: string): Runtime => testRuntime({ env: { [PLUGIN_DATA_ENV_KEY]: pluginData }, cwd: repo, sessionId })
    await fn({ runtimeFor })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const openOrdinaryThread = async (rt: Runtime, slug: string): Promise<string> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: 'guard the resume payload single-copy budget',
    slug,
    active_goal: 'guard the resume payload single-copy budget',
    next_step: 'exercise the resume payload single-copy fixture',
    completion_criteria: [
      { text: 'the predicted payload size tracks the serialised reply within a tight tolerance', check: 'this contract test asserts it', settledness: 'proposed' }
    ]
  })
  if (!opened.ok) {
    throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
  }
  return opened.structured.thread_id
}

type ResumedReply = { threadId: string; briefing: string; hasPreviousSession: boolean; envelopeBytes: number }

const resumeAndMeasure = async (rt: Runtime, threadId: string): Promise<ResumedReply> => {
  const reply = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
  if (!reply.ok) {
    throw new Error(`expected resume_thread to resume the fixture thread, it refused: ${reply.refusal.message}`)
  }
  const envelope = toolOk(reply.text, reply.structured)
  return {
    threadId: reply.structured.thread_id,
    briefing: reply.structured.briefing,
    hasPreviousSession: reply.structured.previous_session !== null,
    envelopeBytes: Buffer.byteLength(JSON.stringify(envelope), 'utf8')
  }
}

test('resume_thread.the-payload-size-prediction-tracks-the-serialised-reply-in-both-directions', async () => {
  await withHarness(async (harness) => {
    const firstRuntime = harness.runtimeFor(FIRST_SESSION)
    const threadId = await openOrdinaryThread(firstRuntime, 'resume-payload-single-copy')

    const resumed = [
      await resumeAndMeasure(firstRuntime, threadId),
      await resumeAndMeasure(harness.runtimeFor(SECOND_SESSION), threadId)
    ]

    assert.deepEqual(
      resumed.map((reply) => reply.hasPreviousSession),
      [false, true],
      'the two resumes must produce one reply with no previous session and one with a previous session, or one branch of the two-sided prediction check is never exercised'
    )

    for (const reply of resumed) {
      const predicted = resumePayloadBytes(reply.briefing, reply.threadId, reply.hasPreviousSession)
      const gap = predicted - reply.envelopeBytes
      const branchLabel = reply.hasPreviousSession ? 'present' : 'absent'

      assert.ok(
        predicted >= reply.envelopeBytes,
        `expected the predicted resume payload size to be at least the size of the reply the server actually serialises, with a previous session ${branchLabel}: predicted ${predicted} bytes against an actual ${reply.envelopeBytes} bytes`
      )

      assert.ok(
        gap <= PREDICTED_OVER_ACTUAL_TOLERANCE_BYTES,
        `expected the predicted resume payload size to exceed the actual serialised size by at most ${PREDICTED_OVER_ACTUAL_TOLERANCE_BYTES} bytes, the only slack the prediction formula permits (previous_session at its largest observed shape, ${PREVIOUS_SESSION_LARGEST_BYTES} bytes, minus its null shape, ${PREVIOUS_SESSION_NULL_BYTES} bytes), with a previous session ${branchLabel}: predicted ${predicted} bytes against an actual ${reply.envelopeBytes} bytes, a gap of ${gap} bytes; a gap this large would silently absorb a whole dropped briefing copy if BRIEFING_COPIES_IN_RESUME_PAYLOAD were lowered without correcting this prediction`
      )
    }
  })
})
