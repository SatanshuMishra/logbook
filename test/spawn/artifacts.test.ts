import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { updateThreadTool } from '../../src/server/tools/update_thread.ts'
import { readThreadRecord, mustGet } from '../support/optional-argument-recipes.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const PLUGIN_DATA_ENV_KEY = 'CLAUDE_PLUGIN_DATA'

type Harness = { rt: Runtime }

const setUpRepo = (repo: string): void => {
  writeFileSync(join(repo, 'README.md'), 'logbook artifacts fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Artifacts Fixture'],
    ['config', 'user.email', 'artifacts-fixture@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) {
      throw new Error(`artifacts fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
    }
  }
}

const withHarness = async (sessionId: string, fn: (harness: Harness) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-artifacts-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-artifacts-plugin-data-'))
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
    completion_criteria: [{ text: 'the artifact list is writable and tombstoned', check: 'the test asserts it' }]
  })
  if (!opened.ok) {
    throw new Error(`expected open_thread to create the fixture thread, it refused: ${opened.refusal.message}`)
  }
  return opened.structured.thread_id
}

test('artifacts.add-mints-an-id-and-stores-the-pointer', async () => {
  await withHarness('artifacts-session-add', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 'artifacts-add')

    const updateArgs: Record<string, unknown> = {
      thread_id: threadId,
      artifacts_add: [{ label: 'the plan', pointer: 'docs/plans/2026-09-05-continuity-handoff/PLAN.md' }]
    }
    const result = await updateThreadTool.handler(
      rt,
      STUB_TOOL_CTX,
      updateArgs as Parameters<typeof updateThreadTool.handler>[2]
    )

    assert.equal(result.ok, true, 'expected update_thread to accept a call carrying artifacts_add')
    if (!result.ok) throw new Error('expected the update to succeed')
    const structured = result.structured as { artifacts_added?: string[] }
    assert.equal(
      structured.artifacts_added?.length,
      1,
      'expected update_thread to report exactly one minted artifact id'
    )

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the updated thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.equal(
      stored.artifacts?.[0]?.pointer,
      'docs/plans/2026-09-05-continuity-handoff/PLAN.md',
      'expected the stored artifact to carry the supplied pointer'
    )
    assert.equal(stored.artifacts?.[0]?.retired, false, 'expected a freshly added artifact to start unretired')
  })
})

test('artifacts.retire-marks-the-entry-and-never-deletes-it', async () => {
  await withHarness('artifacts-session-retire', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 'artifacts-retire')

    const addArgs: Record<string, unknown> = {
      thread_id: threadId,
      artifacts_add: [{ label: 'the plan', pointer: 'docs/plans/x.md' }]
    }
    const added = await updateThreadTool.handler(
      rt,
      STUB_TOOL_CTX,
      addArgs as Parameters<typeof updateThreadTool.handler>[2]
    )
    assert.equal(added.ok, true, 'expected the artifact add call to succeed')
    if (!added.ok) throw new Error('expected the add to succeed')
    const addedStructured = added.structured as { artifacts_added?: string[] }
    assert.ok(
      addedStructured.artifacts_added !== undefined,
      'expected update_thread to mint an artifact id via artifacts_add'
    )
    if (addedStructured.artifacts_added === undefined) throw new Error('expected artifacts_added on the output')
    const artifactId = mustGet(addedStructured.artifacts_added, 0, 'the minted artifact id')

    const retireArgs: Record<string, unknown> = { thread_id: threadId, artifacts_retire: [artifactId] }
    const retired = await updateThreadTool.handler(
      rt,
      STUB_TOOL_CTX,
      retireArgs as Parameters<typeof updateThreadTool.handler>[2]
    )
    assert.equal(retired.ok, true, 'expected the artifact retire call to succeed')

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.equal(stored.artifacts?.length, 1, 'expected the retired artifact to still be present, never deleted')
    assert.equal(stored.artifacts?.[0]?.retired, true, 'expected the retired artifact to be marked retired')
  })
})

test('artifacts.re-retiring-an-entry-changes-nothing', async () => {
  await withHarness('artifacts-session-re-retire', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 're-retire-fixture')

    const added = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      risks_add: [{ text: 'a risk to retire twice', scope: 're-retire' }]
    })
    assert.equal(added.ok, true, 'expected the risk add call to succeed')
    if (!added.ok) throw new Error('expected the add to succeed')
    const riskId = mustGet(added.structured.risks_added, 0, 'the minted risk id')

    const firstRetire = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      risks_retire: [riskId]
    })
    assert.equal(firstRetire.ok, true, 'expected the first risk retire call to succeed')
    if (!firstRetire.ok) throw new Error('expected the first retire to succeed')
    assert.deepEqual(
      firstRetire.structured.risks_retired,
      [riskId],
      'expected the first retire to report the id as retired'
    )

    const afterFirstRetire = readThreadRecord(rt, threadId)
    assert.ok(afterFirstRetire !== null, 'expected the thread to still have a stored record')
    if (afterFirstRetire === null) throw new Error('expected a stored thread record')
    const updatedAtAfterFirstRetire = afterFirstRetire.updated_at

    const secondRetire = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      risks_retire: [riskId]
    })
    assert.equal(secondRetire.ok, true, 'expected the second risk retire call to succeed')
    if (!secondRetire.ok) throw new Error('expected the second retire to succeed')
    assert.deepEqual(
      secondRetire.structured.risks_retired,
      [],
      'expected re-retiring the same id to report nothing retired'
    )

    const afterSecondRetire = readThreadRecord(rt, threadId)
    assert.ok(afterSecondRetire !== null, 'expected the thread to still have a stored record')
    if (afterSecondRetire === null) throw new Error('expected a stored thread record')
    assert.equal(
      afterSecondRetire.updated_at,
      updatedAtAfterFirstRetire,
      'expected re-retiring the same id to leave updated_at unchanged'
    )
  })
})

test('artifacts.risks-retire-marks-the-entry-and-never-deletes-it', async () => {
  await withHarness('artifacts-session-risks-retire', async ({ rt }) => {
    const threadId = await openFixtureThread(rt, 'artifacts-risks-retire')

    const added = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      risks_add: [{ text: 'a risk', scope: 'merge' }]
    })
    assert.equal(added.ok, true, 'expected the risk add call to succeed')
    if (!added.ok) throw new Error('expected the add to succeed')
    const riskId = mustGet(added.structured.risks_added, 0, 'the minted risk id')

    const retired = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      risks_retire: [riskId]
    })
    assert.equal(retired.ok, true, 'expected the risk retire call to succeed')

    const stored = readThreadRecord(rt, threadId)
    assert.ok(stored !== null, 'expected the thread to still have a stored record')
    if (stored === null) throw new Error('expected a stored thread record')
    assert.equal(
      stored.spine.open_risks.length,
      1,
      'expected a retired risk to still be present on the spine, never deleted'
    )
    assert.equal(stored.spine.open_risks[0]?.retired, true, 'expected the retired risk to be marked retired')
  })
})
