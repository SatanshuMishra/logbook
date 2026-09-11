import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { parkThreadTool } from '../../src/server/tools/park_thread.ts'
import { logSessionEventTool } from '../../src/server/tools/log_session_event.ts'
import { readThreadRecord } from '../support/optional-argument-recipes.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

type Harness = { rt: Runtime }

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'logbook park-without-outcome fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Park Without Outcome Fixture'],
    ['config', 'user.email', 'park-without-outcome-fixture@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`park-without-outcome fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (sessionId: string, fn: (harness: Harness) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-park-without-outcome-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-park-without-outcome-plugin-data-'))
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
    active_goal: 'exercise the bare-park remedy against a real bound',
    next_step: 'exercise the bare-park remedy against a real bound',
    completion_criteria: [
      { text: 'a bare park clears the guard', check: 'the test asserts it', settledness: 'proposed' }
    ]
  })
  if (!opened.ok) {
    throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
  }
  return opened.structured.thread_id
}

const logEntry = (rt: Runtime, threadId: string, body: string) =>
  logSessionEventTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId, actor: 'claude', body })

const SEEDED_UNPARKED_ENTRY_COUNT = 25

test('park-thread.bare-park-clears-the-unparked-entries-guard', async () => {
  await withHarness('park-without-outcome-session', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 'park-without-outcome-clears-bound')

    const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    assert.equal(resumed.ok, true, 'expected resume_thread to mark the fixture thread as being worked')

    for (let i = 1; i <= SEEDED_UNPARKED_ENTRY_COUNT; i += 1) {
      const result = await logEntry(rt, threadId, `entry number ${i}`)
      assert.equal(result.ok, true, `expected seed entry ${i} of ${SEEDED_UNPARKED_ENTRY_COUNT} to be accepted`)
    }

    const refused = await logEntry(rt, threadId, 'entry beyond the bound')
    assert.equal(refused.ok, false, 'expected the entry past the seeded bound to be refused')
    if (refused.ok) throw new Error('expected the pre-park append to be refused')
    assert.ok(
      refused.refusal.message.includes('park_thread'),
      `expected the refusal to name park_thread as the remedy, got '${refused.refusal.message}'`
    )

    const parked = await parkThreadTool.handler(rt, STUB_TOOL_CTX, {})
    assert.equal(parked.ok, true, 'expected a bare park_thread call (outcome omitted) to succeed')
    if (!parked.ok) throw new Error('expected the bare park to succeed')
    assert.equal(parked.structured.status, 'parked', 'expected the bare park to report status parked')
    assert.equal(
      parked.structured.session_entry_ids.length,
      1,
      'expected the bare park to report exactly one written session entry'
    )

    const afterPark = await logEntry(rt, threadId, 'entry after the bare park')
    assert.equal(
      afterPark.ok,
      true,
      `expected log_session_event to succeed after the bare park cleared the bound, got refused: ${
        afterPark.ok ? '' : afterPark.refusal.message
      }`
    )

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the parked thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.equal(stored.status, 'open', 'expected the bare park to leave the thread status as open')
  })
})
