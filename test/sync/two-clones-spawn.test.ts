import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, type Dirent } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Declared } from '../../src/schema/declare.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readAllRecordFiles } from '../../src/store/read-path.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = path.join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const CONFLICT_MARKERS = ['<<<<<<<', '=======', '>>>>>>>']

type SpawnedTeammate = {
  name: string
  repo: string
  pluginData: string
  spawned: SpawnedServer
  transportErrors: Error[]
  goOffline: () => void
  goOnline: () => void
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`two-clones-spawn fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const provisionSpawnedTeammate = async (
  remote: string,
  identity: { name: string; email: string }
): Promise<{ teammate: SpawnedTeammate; cleanupDirs: string[] }> => {
  const repo = mkdtempSync(path.join(tmpdir(), `logbook-spawn-clone-${identity.name}-`))
  runSetupStep(repo, ['clone', remote, '.'])
  runSetupStep(repo, ['config', 'user.name', identity.name])
  runSetupStep(repo, ['config', 'user.email', identity.email])

  const pluginData = mkdtempSync(path.join(tmpdir(), `logbook-spawn-plugin-data-${identity.name}-`))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  await spawned.client.listTools()

  const transportErrors: Error[] = []
  spawned.client.onerror = (error: Error): void => {
    transportErrors.push(error)
  }

  const goOffline = (): void => {
    const unreachable = path.join(tmpdir(), `logbook-spawn-unreachable-${randomUUID()}`)
    runSetupStep(repo, ['remote', 'set-url', 'origin', unreachable])
  }
  const goOnline = (): void => {
    runSetupStep(repo, ['remote', 'set-url', 'origin', remote])
  }

  return {
    teammate: { name: identity.name, repo, pluginData, spawned, transportErrors, goOffline, goOnline },
    cleanupDirs: [repo, pluginData]
  }
}

const withTwoSpawnedClones = async (
  fn: (ana: SpawnedTeammate, ben: SpawnedTeammate) => Promise<void>
): Promise<void> => {
  const remote = mkdtempSync(path.join(tmpdir(), 'logbook-spawn-remote-'))
  const cleanupDirs: string[] = []
  const spawnedServers: SpawnedServer[] = []
  try {
    runSetupStep(remote, ['init', '--bare', '--initial-branch=main'])

    const anaProvisioned = await provisionSpawnedTeammate(remote, { name: 'ana', email: 'ana@logbook.test' })
    cleanupDirs.push(...anaProvisioned.cleanupDirs)
    spawnedServers.push(anaProvisioned.teammate.spawned)

    const benProvisioned = await provisionSpawnedTeammate(remote, { name: 'ben', email: 'ben@logbook.test' })
    cleanupDirs.push(...benProvisioned.cleanupDirs)
    spawnedServers.push(benProvisioned.teammate.spawned)

    await fn(anaProvisioned.teammate, benProvisioned.teammate)
  } finally {
    for (const spawned of spawnedServers) {
      await spawned.close()
    }
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    rmSync(remote, { recursive: true, force: true })
  }
}

const assertOkResult = (label: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${label} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

const callTool = async (
  teammate: SpawnedTeammate,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> => (await teammate.spawned.client.callTool({ name, arguments: args })) as CallToolResult

const collectJsonFiles = (dir: string): string[] => {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full)
    }
  }
  return files
}

const declaredFor = (
  filePath: string,
  layout: StoreLayout
): Declared<Thread> | Declared<Decision> | Declared<SessionEntry> => {
  const relative = path.relative(layout.records, filePath)
  const collection = relative.split(path.sep)[0]
  if (collection === 'threads') return ThreadRecord
  if (collection === 'decisions') return DecisionRecord
  if (collection === 'sessions') return SessionRecord
  throw new Error(`two-clones-spawn: unclassifiable record path: ${relative}`)
}

const assertRecordsAreClean = (layout: StoreLayout): void => {
  const files = collectJsonFiles(layout.records)
  assert.ok(files.length > 0, 'expected at least one record file to inspect')
  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    for (const marker of CONFLICT_MARKERS) {
      assert.equal(raw.includes(marker), false, `${file} contains a conflict marker`)
    }
    let parsedJson: unknown = null
    let jsonError: string | null = null
    try {
      parsedJson = JSON.parse(raw)
    } catch (error) {
      jsonError = error instanceof Error ? error.message : String(error)
    }
    assert.equal(jsonError, null, `${file} is not valid JSON: ${jsonError}`)
    const declared = declaredFor(file, layout)
    const parsed = declared.parse(parsedJson)
    assert.equal(parsed.ok, true, `${file} failed schema validation`)
  }
}

const layoutOf = (teammate: SpawnedTeammate): StoreLayout => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: teammate.pluginData } })
  const result = layoutFor(rt, teammate.repo)
  assert.equal(result.ok, true, `expected layoutFor to resolve for ${teammate.name}`)
  if (!result.ok) throw new Error(`layoutFor refused for ${teammate.name}`)
  return result.value
}

const decisionSlotsOf = (teammate: SpawnedTeammate) =>
  readAllRecordFiles<Decision>(path.join(layoutOf(teammate).records, 'decisions'), DecisionRecord)

const threadRecordOf = (teammate: SpawnedTeammate, threadId: string): Thread => {
  const slots = readAllRecordFiles<Thread>(path.join(layoutOf(teammate).records, 'threads'), ThreadRecord)
  for (const slot of slots) {
    if (!slot.quarantined && slot.record.id === threadId) return slot.record
  }
  throw new Error(`two-clones-spawn: thread ${threadId} could not be read back for ${teammate.name}`)
}

const runSpawnOfflineMergeScenario = (pusherFirst: 'ana' | 'ben'): Promise<void> =>
  withTwoSpawnedClones(async (ana, ben) => {
    const opened = await callTool(ana, 'open_thread', {
      title: 'two clones spawn thread',
      slug: `two-clones-spawn-thread-${pusherFirst}`,
      completion_criteria: ['a criterion for the spawn offline-merge scenario']
    })
    assertOkResult('open_thread', opened)
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id

    const anaInitialPush = await callTool(ana, 'sync_ledger', {})
    assertOkResult('sync_ledger (ana initial push)', anaInitialPush)

    const benInitialFastForward = await callTool(ben, 'sync_ledger', {})
    assertOkResult('sync_ledger (ben initial fast-forward)', benInitialFastForward)

    ana.goOffline()
    ben.goOffline()

    const anaDecision = await callTool(ana, 'record_decision', {
      thread_id: threadId,
      title: 'ana records a decision offline',
      context: 'ana recorded this while offline',
      options: ['keep it simple', 'add more detail'],
      outcome: 'ana chose to keep it simple'
    })
    assertOkResult('record_decision (ana, offline)', anaDecision)
    const anaDecisionId = (anaDecision.structuredContent as { decision_id: string }).decision_id

    const benDecision = await callTool(ben, 'record_decision', {
      thread_id: threadId,
      title: 'ben records a decision offline',
      context: 'ben recorded this while offline',
      options: ['keep it simple', 'add more detail'],
      outcome: 'ben chose to keep it simple'
    })
    assertOkResult('record_decision (ben, offline)', benDecision)
    const benDecisionId = (benDecision.structuredContent as { decision_id: string }).decision_id

    assert.notEqual(anaDecisionId, benDecisionId)

    ana.goOnline()
    ben.goOnline()

    const first = pusherFirst === 'ana' ? ana : ben
    const second = pusherFirst === 'ana' ? ben : ana
    const firstDecisionId = pusherFirst === 'ana' ? anaDecisionId : benDecisionId
    const secondDecisionId = pusherFirst === 'ana' ? benDecisionId : anaDecisionId

    const firstSync = await callTool(first, 'sync_ledger', {})
    assertOkResult('sync_ledger (first)', firstSync)

    const secondSync = await callTool(second, 'sync_ledger', {})
    assertOkResult('sync_ledger (second, must merge rather than clobber)', secondSync)
    const secondSyncStructured = secondSync.structuredContent as { action: string }
    assert.equal(
      secondSyncStructured.action,
      'merged',
      'the second teammate to sync after an offline divergence must merge, not clobber'
    )

    const secondDecisionSlots = decisionSlotsOf(second)
    const secondLive = secondDecisionSlots.filter((slot) => !slot.quarantined)
    assert.equal(secondLive.length, 2, 'nothing lost: the second teammate must hold both decisions')
    assert.deepEqual(
      new Set(secondLive.map((slot) => slot.record.id)),
      new Set([firstDecisionId, secondDecisionId]),
      'nothing lost: the second teammate must hold exactly the two decisions by id'
    )

    assert.notEqual(firstDecisionId, secondDecisionId, 'no collision: the two identifiers must be distinct')

    const mergedThread = threadRecordOf(second, threadId)
    assert.equal(
      mergedThread.spine.key_decisions.length,
      2,
      'nothing lost: both clones now write the thread record offline, so the merged running summary must carry both links'
    )
    assert.deepEqual(
      new Set(mergedThread.spine.key_decisions.map((entry) => entry.decision_id)),
      new Set([firstDecisionId, secondDecisionId]),
      'nothing lost: the merged running summary must link exactly the two decisions by id'
    )

    assertRecordsAreClean(layoutOf(second))

    const firstConvergedSync = await callTool(first, 'sync_ledger', {})
    assertOkResult('sync_ledger (first, converge)', firstConvergedSync)

    const firstDecisionSlots = decisionSlotsOf(first)
    const firstSeesSecond = firstDecisionSlots.some(
      (slot) => !slot.quarantined && slot.record.id === secondDecisionId
    )
    assert.equal(firstSeesSecond, true, "convergence: the first teammate's next sync must see the second's decision")

    assertRecordsAreClean(layoutOf(first))

    assert.deepEqual(ana.transportErrors, [], 'a real server must never write anything that breaks the stdio transport')
    assert.deepEqual(ben.transportErrors, [], 'a real server must never write anything that breaks the stdio transport')
  })

test('sync.two-clones-offline.spawn', async () => {
  await runSpawnOfflineMergeScenario('ana')
})

test('sync.two-clones-offline.spawn.ben-pushes-first', async () => {
  await runSpawnOfflineMergeScenario('ben')
})
