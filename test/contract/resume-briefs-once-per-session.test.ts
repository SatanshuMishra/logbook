import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { BRIEFED_ALREADY_LINE } from '../../src/render/briefing.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const FIRST_SESSION = 'resume-briefs-once-session-one'
const SECOND_SESSION = 'resume-briefs-once-session-two'

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

const FULL_BRIEFING_MARKER = '**Completion criteria:**'

type Harness = { runtimeFor: (sessionId: string) => Runtime }

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'logbook resume briefs once fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Resume Briefs Once Fixture'],
    ['config', 'user.email', 'resume-briefs-once@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`resume briefs once fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (fn: (harness: Harness) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-resume-briefs-once-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-resume-briefs-once-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  try {
    setUpRepo(repo)
    const runtimeFor = (sessionId: string): Runtime =>
      testRuntime({ env: { [PLUGIN_DATA_ENV_KEY]: pluginData }, cwd: repo, sessionId })
    await fn({ runtimeFor })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const openOrdinaryThread = async (rt: Runtime, slug: string): Promise<string> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: 'brief a session once per thread',
    slug,
    active_goal: 'brief a session once per thread',
    next_step: 'resume the fixture thread twice',
    completion_criteria: [
      {
        text: 'the second resume in one session returns the head of the briefing',
        check: 'this contract test asserts it',
        settledness: 'proposed'
      }
    ]
  })
  if (!opened.ok) {
    throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
  }
  return opened.structured.thread_id
}

const resume = async (rt: Runtime, input: { thread_id: string; full_briefing?: boolean }): Promise<string> => {
  const reply = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, input)
  if (!reply.ok) {
    throw new Error(`expected resume_thread to resume the fixture thread, it refused: ${reply.refusal.message}`)
  }
  return reply.structured.briefing
}

test('resume_thread.briefs-a-session-once-per-thread-and-hands-back-the-head-after-that', async () => {
  await withHarness(async (harness) => {
    const rt = harness.runtimeFor(FIRST_SESSION)
    const threadId = await openOrdinaryThread(rt, 'resume-briefs-once')
    const otherId = await openOrdinaryThread(rt, 'resume-briefs-once-other')

    const first = await resume(rt, { thread_id: threadId })
    const second = await resume(rt, { thread_id: threadId })
    const other = await resume(rt, { thread_id: otherId })
    const third = await resume(rt, { thread_id: threadId })

    assert.ok(
      first.includes(FULL_BRIEFING_MARKER),
      'the first resume of a thread in a session must render the full briefing'
    )
    assert.ok(
      second.includes(BRIEFED_ALREADY_LINE),
      'the second resume of the same thread in the same session must render the head'
    )
    assert.equal(second.includes(FULL_BRIEFING_MARKER), false)
    assert.ok(second.length < first.length)
    assert.ok(
      other.includes(FULL_BRIEFING_MARKER),
      'a thread this session has not been briefed on must render the full briefing'
    )
    assert.ok(
      third.includes(BRIEFED_ALREADY_LINE),
      'every later resume of a briefed thread must render the head'
    )
  })
})

test('resume_thread.a-new-session-is-briefed-again-on-a-thread-an-earlier-session-read', async () => {
  await withHarness(async (harness) => {
    const first = harness.runtimeFor(FIRST_SESSION)
    const threadId = await openOrdinaryThread(first, 'resume-briefs-once-new-session')
    await resume(first, { thread_id: threadId })

    const second = await resume(harness.runtimeFor(SECOND_SESSION), { thread_id: threadId })

    assert.ok(second.includes(FULL_BRIEFING_MARKER))
  })
})

test('resume_thread.full-briefing-asks-for-the-whole-text-back-on-a-thread-already-briefed', async () => {
  assert.equal(
    resumeThreadTool.input.safeParse({ thread_id: '01M0NDPM0ACCR9CD68PMHYWGGD', full_briefing: true }).success,
    true,
    'the input must accept the one override that asks for more text'
  )

  await withHarness(async (harness) => {
    const rt = harness.runtimeFor(FIRST_SESSION)
    const threadId = await openOrdinaryThread(rt, 'resume-briefs-once-override')
    await resume(rt, { thread_id: threadId })

    const forced = await resume(rt, { thread_id: threadId, full_briefing: true })

    assert.ok(forced.includes(FULL_BRIEFING_MARKER))
    assert.equal(forced.includes(BRIEFED_ALREADY_LINE), false)
  })
})

test('resume_thread.takes-no-input-that-asks-for-less-than-the-rule-gives', () => {
  const parsed = resumeThreadTool.input.safeParse({
    thread_id: '01M0NDPM0ACCR9CD68PMHYWGGD',
    briefing: 'none'
  })

  assert.equal(parsed.success, false, 'the input is strict, so no key can be introduced that suppresses a briefing')
})
