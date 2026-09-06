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
import { readThreadRecord } from '../support/optional-argument-recipes.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

type Harness = { rt: Runtime }

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'logbook handoff fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Handoff Fixture'],
    ['config', 'user.email', 'handoff-fixture@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`handoff fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (sessionId: string, fn: (harness: Harness) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-handoff-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-handoff-plugin-data-'))
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
    completion_criteria: [{ text: 'the hand-off fields round-trip', check: 'the test asserts it' }]
  })
  if (!opened.ok) {
    throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
  }
  return opened.structured.thread_id
}

test('handoff.park-stores-landed-alongside-next-step', async () => {
  await withHarness('handoff-session-one', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 'handoff-park-landed')
    const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    assert.equal(resumed.ok, true, 'expected resume_thread to mark the fixture thread as being worked')

    const parkArgs: Record<string, unknown> = {
      outcome: 'shipped the schema unit',
      landed: 'spine.landed exists and parses; nothing reads it yet',
      next_step: 'wire artifacts into mergeThreadTraced'
    }
    const result = await parkThreadTool.handler(
      rt,
      STUB_TOOL_CTX,
      parkArgs as Parameters<typeof parkThreadTool.handler>[2]
    )

    assert.equal(result.ok, true, 'expected park_thread to accept a call carrying landed alongside next_step')
    if (!result.ok) throw new Error('expected the park to succeed')
    assert.deepEqual(
      [...result.structured.spine_fields_updated].sort(),
      ['landed', 'next_step'],
      'expected park_thread to report both landed and next_step as updated spine fields'
    )

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the parked thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.equal(
      stored.spine.landed,
      'spine.landed exists and parses; nothing reads it yet',
      'expected the stored spine.landed to hold the text supplied to park_thread'
    )
  })
})

test('handoff.park-without-landed-leaves-the-stored-value-alone', async () => {
  await withHarness('handoff-session-two', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 'handoff-park-landed-preserved')
    const firstResume = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    assert.equal(firstResume.ok, true, 'expected the first resume_thread call to succeed')

    const firstParkArgs: Record<string, unknown> = { outcome: 'first', landed: 'the first landing' }
    const firstPark = await parkThreadTool.handler(
      rt,
      STUB_TOOL_CTX,
      firstParkArgs as Parameters<typeof parkThreadTool.handler>[2]
    )
    assert.equal(firstPark.ok, true, 'expected the first park_thread call to succeed')

    const secondResume = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    assert.equal(secondResume.ok, true, 'expected the second resume_thread call to succeed')

    const secondPark = await parkThreadTool.handler(rt, STUB_TOOL_CTX, {
      outcome: 'second',
      next_step: 'do the next thing'
    })
    assert.equal(secondPark.ok, true, 'expected the second park_thread call to succeed')

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the twice-parked thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.equal(
      stored.spine.landed,
      'the first landing',
      'expected the second park, which omitted landed, to leave the value the first park stored untouched'
    )
  })
})
