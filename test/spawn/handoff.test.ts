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
import { commitThread, openProjectStore } from '../../src/server/tool-support.ts'
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

type FixtureThread = { threadId: string; criterionId: string }

const openFixtureThread = async (rt: Runtime, slug: string): Promise<FixtureThread> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: `${slug} fixture thread`,
    slug,
    active_goal: 'exercise the hand-off fixture',
    next_step: 'exercise the hand-off fixture',
    next_step_records: [],
    completion_criteria: [{ text: 'the hand-off fields round-trip', check: 'the test asserts it', settledness: 'proposed' }]
  })
  if (!opened.ok) {
    throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
  }
  const criterionId = opened.structured.completion_criteria[0]?.id
  if (criterionId === undefined) throw new Error('expected open_thread to mint the fixture criterion')
  return { threadId: opened.structured.thread_id, criterionId }
}

const storeLanded = (rt: Runtime, threadId: string, landed: string): void => {
  const opened = openProjectStore(rt)
  if (!opened.ok) throw new Error(`expected the hand-off fixture store to open: ${opened.refusal.message}`)
  const stored = readThreadRecord(rt, threadId)
  if (stored === null) throw new Error('expected the hand-off fixture thread to have a stored record')
  const committed = commitThread(opened.value, { ...stored, spine: { ...stored.spine, landed } }, 'seed a landed value')
  if (!committed.ok) throw new Error(`expected the landed seed to commit: ${committed.refusal.message}`)
}

test('handoff.park-stores-the-next-step-records-with-the-next-step', async () => {
  await withHarness('handoff-session-one', async ({ rt }) => {
    const { threadId, criterionId } = await openFixtureThread(rt, 'handoff-park-records')
    const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    assert.equal(resumed.ok, true, 'expected resume_thread to mark the fixture thread as being worked')

    const result = await parkThreadTool.handler(rt, STUB_TOOL_CTX, {
      next_step: 'wire artifacts into mergeThreadTraced',
      next_step_records: [criterionId]
    })

    assert.equal(result.ok, true, 'expected park_thread to accept a next step sent with its records')
    if (!result.ok) throw new Error('expected the park to succeed')
    assert.deepEqual(
      result.structured.spine_fields_updated,
      ['next_step'],
      'expected park_thread to report next_step as the only spine field it can update'
    )
    assert.ok(
      result.structured.step_records?.includes(criterionId) === true,
      `expected the park reply to return the named criterion in full, got ${JSON.stringify(result.structured.step_records)}`
    )

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the parked thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.deepEqual(
      stored.spine.next_step_records,
      [criterionId],
      'expected the stored spine to hold the records list sent with the next step'
    )
  })
})

test('handoff.park-leaves-a-stored-landed-value-alone', async () => {
  await withHarness('handoff-session-two', async ({ rt }) => {
    const { threadId } = await openFixtureThread(rt, 'handoff-park-landed-preserved')
    storeLanded(rt, threadId, 'the first landing')
    const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, { thread_id: threadId })
    assert.equal(resumed.ok, true, 'expected resume_thread to succeed')

    const parked = await parkThreadTool.handler(rt, STUB_TOOL_CTX, {
      outcome: 'second',
      next_step: 'do the next thing',
      next_step_records: []
    })
    assert.equal(parked.ok, true, 'expected the park_thread call to succeed')

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the parked thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.equal(
      stored.spine.landed,
      'the first landing',
      'expected a park, which no longer writes landed, to leave the stored landed value untouched'
    )
  })
})
