import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { writePointer } from '../../src/domain/pointer.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type PointerScenario = 'absent' | 'foreign'
const POINTER_SCENARIOS: readonly PointerScenario[] = ['absent', 'foreign']

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (prefix: string): string => {
  const repo = mkdtempSync(join(tmpdir(), `${prefix}-`))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook S4 Fixture'])
  runSetupStep(repo, ['config', 'user.email', 's4@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook s4 fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const writeForeignPointer = (repo: string, pluginData: string): void => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const layout = layoutFor(rt, repo)
  if (!layout.ok) throw new Error(`write-tools.ignore-the-pointer: could not resolve layout to write a foreign pointer: ${layout.message}`)
  writePointer(rt, layout.value, {
    thread_id: rt.ulid(),
    written_at: rt.now(),
    session_id: 'a-foreign-session-untouched-by-this-call',
    focus: []
  })
}

const callTool = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await spawned.client.callTool({ name, arguments: args })) as CallToolResult

const assertOk = (name: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${name} expected ok, got a refusal: ${JSON.stringify(result.content)}`)
}

const OPEN_THREAD_ARGS = {
  title: 's4 fixture thread',
  slug: 's4-fixture-thread',
  completion_criteria: [{ text: 's4 fixture criterion', check: 's4 fixture check' }]
}

type Recipe = (scenario: PointerScenario) => Promise<CallToolResult>

const withFreshFixture = async (
  scenario: PointerScenario,
  run: (spawned: SpawnedServer) => Promise<CallToolResult>
): Promise<CallToolResult> => {
  const repo = bootstrapRepo('logbook-s4-repo')
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-s4-plugin-data-'))
  if (scenario === 'foreign') writeForeignPointer(repo, pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    return await run(spawned)
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const openFixtureThread = async (spawned: SpawnedServer): Promise<string> => {
  const opened = await callTool(spawned, 'open_thread', OPEN_THREAD_ARGS)
  assertOk('open_thread (prep)', opened)
  return (opened.structuredContent as { thread_id: string }).thread_id
}

const recipeOpenThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => callTool(spawned, 'open_thread', OPEN_THREAD_ARGS))

const recipeUpdateThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'update_thread', { thread_id: threadId, active_goal: 's4 active goal' })
  })

const recipeCloseThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'close_thread', { thread_id: threadId, outcome: 'abandoned', detail: 's4 abandon reason' })
  })

const recipeAmendCriteria: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    const decided = await callTool(spawned, 'record_decision', {
      thread_id: threadId,
      title: 's4 decision title',
      context: 's4 decision context',
      options: ['option a', 'option b'],
      outcome: 's4 decision outcome',
      scope: 's4 scope'
    })
    assertOk('record_decision (prep)', decided)
    const decisionId = (decided.structuredContent as { decision_id: string }).decision_id
    return callTool(spawned, 'amend_criteria', {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      text: 's4 inserted criterion',
      kind: 'detour',
      check: 's4 inserted check'
    })
  })

const recipeBindBranch: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'bind_branch', { thread_id: threadId, branch: 's4-fixture-branch' })
  })

const recipeResumeThread: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'resume_thread', { thread_id: threadId })
  })

const recipeParkThread: Recipe = (scenario) => withFreshFixture(scenario, async (spawned) => callTool(spawned, 'park_thread', {}))

const recipeRecordDecision: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'record_decision', {
      thread_id: threadId,
      title: 's4 decision title',
      context: 's4 decision context',
      options: ['option a', 'option b'],
      outcome: 's4 decision outcome',
      scope: 's4 scope'
    })
  })

const recipeLogSessionEvent: Recipe = (scenario) =>
  withFreshFixture(scenario, async (spawned) => {
    const threadId = await openFixtureThread(spawned)
    return callTool(spawned, 'log_session_event', { thread_id: threadId, actor: 'claude', body: 's4 session body' })
  })

const recipeSyncLedger: Recipe = async (scenario) => {
  const bare = mkdtempSync(join(tmpdir(), 'logbook-s4-sync-remote-'))
  const initResult = rawGit(bare, ['init', '--bare', '--initial-branch=main'])
  if (initResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not init the bare remote: ${initResult.stderr}`)
  }
  const repo = bootstrapRepo('logbook-s4-sync-repo')
  const addResult = rawGit(repo, ['remote', 'add', 'origin', bare])
  if (addResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not add the origin remote: ${addResult.stderr}`)
  }
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-s4-sync-plugin-data-'))
  if (scenario === 'foreign') writeForeignPointer(repo, pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    return await callTool(spawned, 'sync_ledger', {})
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(bare, { recursive: true, force: true })
  }
}

type Teammate = { repo: string; pluginData: string; spawned: SpawnedServer }

const provisionTeammate = async (remote: string, name: string): Promise<Teammate> => {
  const repo = mkdtempSync(join(tmpdir(), `logbook-s4-resolve-${name}-repo-`))
  const cloneResult = rawGit(repo, ['clone', remote, '.'])
  if (cloneResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not clone the remote for ${name}: ${cloneResult.stderr}`)
  }
  const nameResult = rawGit(repo, ['config', 'user.name', name])
  if (nameResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not set user.name for ${name}: ${nameResult.stderr}`)
  }
  const emailResult = rawGit(repo, ['config', 'user.email', `${name}@logbook.test`])
  if (emailResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not set user.email for ${name}: ${emailResult.stderr}`)
  }
  const pluginData = mkdtempSync(join(tmpdir(), `logbook-s4-resolve-${name}-plugin-data-`))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  return { repo, pluginData, spawned }
}

const recipeResolveConflict: Recipe = async (scenario) => {
  const remote = mkdtempSync(join(tmpdir(), 'logbook-s4-resolve-remote-'))
  const initResult = rawGit(remote, ['init', '--bare', '--initial-branch=main'])
  if (initResult.status !== 0) {
    throw new Error(`write-tools.ignore-the-pointer: could not init the bare remote: ${initResult.stderr}`)
  }

  const ana = await provisionTeammate(remote, `ana-${scenario}`)
  const ben = await provisionTeammate(remote, `ben-${scenario}`)
  try {
    const opened = await callTool(ana.spawned, 'open_thread', {
      title: 's4 resolve conflict fixture thread',
      slug: `s4-resolve-conflict-${scenario}`,
      completion_criteria: [{ text: 's4 resolve fixture criterion', check: 's4 resolve fixture check' }]
    })
    assertOk('open_thread (resolve prep)', opened)
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id

    assertOk('sync_ledger (ana initial push)', await callTool(ana.spawned, 'sync_ledger', {}))
    assertOk('sync_ledger (ben initial fast-forward)', await callTool(ben.spawned, 'sync_ledger', {}))

    const benUpdate = await callTool(ben.spawned, 'update_thread', { thread_id: threadId, active_goal: 'ben active goal' })
    assertOk('update_thread (ben)', benUpdate)
    const benPush = await callTool(ben.spawned, 'sync_ledger', {})
    assertOk('sync_ledger (ben pushes)', benPush)

    const anaUpdate = await callTool(ana.spawned, 'update_thread', { thread_id: threadId, active_goal: 'ana active goal' })
    assertOk('update_thread (ana)', anaUpdate)

    const anaConflictSync = await callTool(ana.spawned, 'sync_ledger', {})
    assert.equal(
      anaConflictSync.isError,
      true,
      'write-tools.ignore-the-pointer: expected a real two-sided conflict to have been built for the resolve_conflict recipe'
    )

    if (scenario === 'foreign') writeForeignPointer(ana.repo, ana.pluginData)

    return await callTool(ana.spawned, 'resolve_conflict', {
      resolutions: [{ record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' }]
    })
  } finally {
    await ana.spawned.close()
    await ben.spawned.close()
    rmSync(ana.repo, { recursive: true, force: true })
    rmSync(ana.pluginData, { recursive: true, force: true })
    rmSync(ben.repo, { recursive: true, force: true })
    rmSync(ben.pluginData, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
}

const RECIPES: Readonly<Record<string, Recipe>> = {
  open_thread: recipeOpenThread,
  update_thread: recipeUpdateThread,
  close_thread: recipeCloseThread,
  amend_criteria: recipeAmendCriteria,
  bind_branch: recipeBindBranch,
  resume_thread: recipeResumeThread,
  park_thread: recipeParkThread,
  record_decision: recipeRecordDecision,
  log_session_event: recipeLogSessionEvent,
  sync_ledger: recipeSyncLedger,
  resolve_conflict: recipeResolveConflict
}

const driveRecipesFor = async (toolNames: readonly string[]): Promise<void> => {
  for (const toolName of toolNames) {
    const recipe = RECIPES[toolName]
    if (recipe === undefined) {
      throw new Error(`write-tools.ignore-the-pointer: no recipe registered for write tool "${toolName}"`)
    }
    for (const scenario of POINTER_SCENARIOS) {
      const result = await recipe(scenario)
      assert.notEqual(
        result.isError,
        true,
        `write-tools.ignore-the-pointer: ${toolName} (pointer ${scenario}) expected ok, got a refusal: ${JSON.stringify(result.content)}`
      )
    }
  }
}

test('write-tools.ignore-the-pointer', async () => {
  const writeToolNames = ALL_TOOLS.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name)
  assert.ok(writeToolNames.length > 0, 'expected at least one write tool in the published register, or this census proves nothing')
  await driveRecipesFor(writeToolNames)
})

test('write-tools.ignore-the-pointer.control.halts-on-a-write-tool-with-no-registered-recipe', async () => {
  await assert.rejects(
    () => driveRecipesFor(['not_a_real_write_tool']),
    /no recipe registered for write tool "not_a_real_write_tool"/
  )
})
