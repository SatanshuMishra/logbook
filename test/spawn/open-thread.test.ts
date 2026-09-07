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
    throw new Error(`open-thread fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-open-thread-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Open Thread Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'open-thread@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook open-thread fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-open-thread-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-open-thread-home-'))
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

const readThreadRecord = (fx: Fixture, threadId: string): Thread => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`open-thread fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`open-thread fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

test('open_thread.refuses-a-thread-with-no-active-goal', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, { title: 'a thread', slug: 'no-goal', next_step: 'read the spec' })

    assert.equal(reply.isError, true, 'a thread that does not say what the work is cannot be opened')
  })
})

test('open_thread.refuses-a-whitespace-only-next-step', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'blank-next-step',
      active_goal: 'ship the recording model',
      next_step: '   '
    })

    assert.equal(reply.isError, true, 'a next step made only of spaces states nothing and is refused')
  })
})

test('open_thread.accepts-a-thread-carrying-no-criteria', async () => {
  await withFixture(async (fx) => {
    const withEmpty = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'empty-criteria',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: []
    })
    const withAbsent = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'absent-criteria',
      active_goal: 'ship the recording model',
      next_step: 'read the spec'
    })

    assert.equal(withEmpty.isError, undefined, 'an empty criteria array opens a thread')
    assert.equal(withAbsent.isError, undefined, 'an absent criteria argument opens a thread')
  })
})

test('open_thread.writes-the-goal-and-the-next-step-into-the-spine', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'spine-populated',
      active_goal: 'ship the recording model',
      next_step: 'read the spec'
    })

    const structured = reply.structuredContent as { thread_id: string }
    const thread = readThreadRecord(fx, structured.thread_id)

    assert.equal(thread.spine.active_goal, 'ship the recording model', 'the goal a fresh session reads first is populated at open')
    assert.equal(thread.spine.next_step, 'read the spec', 'the next step a fresh session reads first is populated at open')
  })
})
