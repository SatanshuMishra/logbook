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
import { commitThread, openProjectStore } from '../../src/server/tool-support.ts'
import { resumePayloadBytes, BRIEFING_MAX_CHARS, RESUME_PAYLOAD_MAX_BYTES } from '../../src/render/briefing.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { overBudgetThread } from '../support/briefing-over-budget-fixture.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const BUDGET_EXCEEDED_EVENT = 'briefing.budget-exceeded'

const FIRST_SESSION = 'resume-payload-session-one'
const SECOND_SESSION = 'resume-payload-session-two'

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

type LoggedRecord = Record<string, unknown>

type Harness = {
  events: LoggedRecord[]
  runtimeFor: (sessionId: string) => Runtime
}

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'logbook resume payload fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Resume Payload Fixture'],
    ['config', 'user.email', 'resume-payload@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`resume payload fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (fn: (harness: Harness) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-resume-payload-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-resume-payload-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  try {
    setUpRepo(repo)
    const events: LoggedRecord[] = []
    const runtimeFor = (sessionId: string): Runtime => ({
      ...testRuntime({ env: { [PLUGIN_DATA_ENV_KEY]: pluginData }, cwd: repo, sessionId }),
      log: (record) => {
        events.push(record)
      }
    })
    await fn({ events, runtimeFor })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const openOrdinaryThread = async (rt: Runtime, slug: string): Promise<string> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: 'guard the resume payload byte budget',
    slug,
    completion_criteria: [
      { text: 'the predicted payload size bounds the serialised reply', check: 'the envelope test asserts it' }
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

test('resume_thread.the-payload-size-prediction-bounds-the-serialised-reply-envelope', async () => {
  await withHarness(async (harness) => {
    const firstRuntime = harness.runtimeFor(FIRST_SESSION)
    const threadId = await openOrdinaryThread(firstRuntime, 'resume-payload-envelope')

    const resumed = [
      await resumeAndMeasure(firstRuntime, threadId),
      await resumeAndMeasure(harness.runtimeFor(SECOND_SESSION), threadId)
    ]

    assert.deepEqual(
      resumed.map((reply) => reply.hasPreviousSession),
      [false, true],
      'the two resumes must produce one reply with no previous session and one with a previous session, or one branch of the prediction is never exercised'
    )

    for (const reply of resumed) {
      const predicted = resumePayloadBytes(reply.briefing, reply.threadId, reply.hasPreviousSession)
      assert.ok(
        predicted >= reply.envelopeBytes,
        `expected the predicted resume payload size to be at least the size of the reply the server actually serialises, with a previous session ${reply.hasPreviousSession ? 'present' : 'absent'}: predicted ${predicted} bytes against an actual ${reply.envelopeBytes} bytes`
      )
    }
  })
})

test('resume_thread.logs-a-budget-breach-only-for-a-render-that-does-not-fit', async () => {
  await withHarness(async (harness) => {
    const rt = harness.runtimeFor(FIRST_SESSION)
    const ordinaryThreadId = await openOrdinaryThread(rt, 'resume-payload-budget-log')

    const ordinary = await resumeAndMeasure(rt, ordinaryThreadId)
    assert.ok(
      ordinary.briefing.length <= BRIEFING_MAX_CHARS,
      `the ordinary thread must render inside the character cap for its silence to mean anything, got ${ordinary.briefing.length}`
    )
    assert.ok(
      ordinary.envelopeBytes <= RESUME_PAYLOAD_MAX_BYTES,
      `the ordinary thread must serialise inside the byte cap for its silence to mean anything, got ${ordinary.envelopeBytes}`
    )
    assert.deepEqual(
      harness.events.filter((record) => record.event === BUDGET_EXCEEDED_EVENT),
      [],
      'resuming a thread that fits the budget must log no budget breach'
    )

    const opened = openProjectStore(rt)
    if (!opened.ok) {
      throw new Error(`expected the project store to open for the over-budget fixture: ${opened.refusal.message}`)
    }
    const planted = commitThread(opened.value, overBudgetThread(rt), 'fixture: an over-budget thread record')
    if (!planted.ok) {
      throw new Error(`expected the over-budget fixture to be admissible and committable: ${planted.refusal.message}`)
    }

    const breaching = await resumeAndMeasure(rt, planted.value.id)
    assert.ok(
      breaching.briefing.length > BRIEFING_MAX_CHARS,
      `the over-budget fixture must actually render past the ${BRIEFING_MAX_CHARS} character cap, got ${breaching.briefing.length}`
    )

    const breaches = harness.events.filter((record) => record.event === BUDGET_EXCEEDED_EVENT)
    assert.equal(
      breaches.length,
      1,
      `resuming a thread that does not fit the budget must log exactly one budget breach, got ${breaches.length}`
    )
    assert.deepEqual(
      breaches.map((record) => [record.level, record.chars, record.bytes]),
      [
        [
          'error',
          breaching.briefing.length,
          resumePayloadBytes(breaching.briefing, breaching.threadId, breaching.hasPreviousSession)
        ]
      ],
      'the logged breach must report the size of the briefing the call actually returned'
    )
  })
})
