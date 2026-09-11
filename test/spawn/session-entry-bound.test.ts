import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { logSessionEventTool } from '../../src/server/tools/log_session_event.ts'
import * as caps from '../../src/schema/caps.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

type Harness = { rt: Runtime }

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'logbook session entry bound fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Session Entry Bound Fixture'],
    ['config', 'user.email', 'session-entry-bound-fixture@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`session entry bound fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (sessionId: string, fn: (harness: Harness) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-session-entry-bound-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-session-entry-bound-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  try {
    setUpRepo(repo)
    const rt = testRuntime({ env: { [PLUGIN_DATA_ENV_KEY]: pluginData }, cwd: repo, sessionId })
    await fn({ rt })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const openFixtureThread = async (rt: Runtime, slug: string): Promise<string> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: `${slug} fixture thread`,
    slug,
    active_goal: 'exercise the session entry bound fixture',
    next_step: 'exercise the session entry bound fixture',
    completion_criteria: [
      { text: 'the bound is enforced', check: 'the test asserts it', settledness: 'proposed' }
    ]
  })
  if (!opened.ok) {
    throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
  }
  return opened.structured.thread_id
}

const logEntry = (rt: Runtime, threadId: string, body: string) =>
  logSessionEventTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId, actor: 'claude', body })

test('log-session-event.refuses-the-26th-unparked-entry-and-names-park-thread', async () => {
  await withHarness('session-entry-bound-session', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 'session-entry-bound-refuses-26th')

    for (let i = 1; i <= caps.SESSION_UNPARKED_ENTRIES_MAX - 1; i += 1) {
      const result = await logEntry(rt, threadId, `entry number ${i}`)
      assert.equal(result.ok, true, `expected entry ${i} of ${caps.SESSION_UNPARKED_ENTRIES_MAX - 1} to be accepted`)
    }

    const boundaryResult = await logEntry(rt, threadId, `entry number ${caps.SESSION_UNPARKED_ENTRIES_MAX}`)
    assert.equal(
      boundaryResult.ok,
      true,
      `expected the ${caps.SESSION_UNPARKED_ENTRIES_MAX}th entry, appended while ${caps.SESSION_UNPARKED_ENTRIES_MAX - 1} un-parked entries already exist, to be accepted`
    )

    const overflowResult = await logEntry(
      rt,
      threadId,
      `entry number ${caps.SESSION_UNPARKED_ENTRIES_MAX + 1}`
    )
    assert.equal(
      overflowResult.ok,
      false,
      `expected the ${caps.SESSION_UNPARKED_ENTRIES_MAX + 1}th entry, appended while ${caps.SESSION_UNPARKED_ENTRIES_MAX} un-parked entries already exist, to be refused`
    )
    if (overflowResult.ok) throw new Error('expected the overflow call to be refused')
    assert.ok(
      overflowResult.refusal.message.includes('park_thread'),
      `expected the refusal to name park_thread as the remedy, got '${overflowResult.refusal.message}'`
    )
    assert.equal(overflowResult.refusal.retryable, true, 'expected the refusal to be retryable after a park')
  })
})
