import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { openStore } from '../../src/store/records.ts'
import type { Thread } from '../../src/schema/thread.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`update-thread fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-update-thread-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Update Thread Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'update-thread@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook update-thread fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-update-thread-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-update-thread-home-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await fn({ spawned, repo, pluginData, homeDir })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const callOpenThread = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'open_thread', arguments: args })) as CallToolResult

const callUpdateThread = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'update_thread', arguments: args })) as CallToolResult

const readThreadRecord = (fx: Fixture, threadId: string): Thread => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`update-thread fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`update-thread fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

test('update_thread.refuses-marking-an-unsettled-criterion-done', async () => {
  await withFixture(async (fx) => {
    const opened = await callOpenThread(fx, {
      title: 'unsettled-criterion thread',
      slug: 'unsettled-criterion-thread',
      active_goal: 'exercise the unsettled-criterion fixture',
      next_step: 'exercise the unsettled-criterion fixture',
      completion_criteria: [{ text: 'what counts as acceptable latency is not decided', settledness: 'unsettled' }]
    })
    assert.equal(opened.isError, undefined, 'an unsettled criterion asserts nothing, so open_thread accepts it with no check')
    const openedStructured = opened.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
    const threadId = openedStructured.thread_id
    const unsettledId = openedStructured.completion_criteria[0]?.id
    assert.ok(unsettledId !== undefined, 'unsettled-criterion fixture: open_thread minted no completion criteria')

    const markDone = await callUpdateThread(fx, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: unsettledId, result: 'the check was run', result_status: 'verified' }]
    })

    assert.equal(markDone.isError, true, 'an unsettled criterion cannot be marked done')
    const text = firstTextOf(markDone)
    assert.ok(
      text.includes('asserts nothing'),
      `the refusal has to say why an unsettled criterion takes no result, got: ${text}`
    )

    const stored = readThreadRecord(fx, threadId)
    const criterion = stored.completion_criteria.find((c) => c.id === unsettledId)
    assert.ok(criterion !== undefined, 'the unsettled criterion vanished from the stored thread')
    assert.equal(criterion.done, false, 'a refused call must not have written the criterion done first')
    assert.equal(criterion.result ?? null, null, 'a refused call must not have written a result')
  })
})
