import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, type Dirent } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Declared } from '../../src/schema/declare.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readAllRecordFiles } from '../../src/store/read-path.ts'
import { writeRecords } from '../../src/store/write-path.ts'
import { rawGit } from '../support/git-fixture.ts'
import { readResourceText } from '../support/resources-fixture.ts'
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

  const pluginDataHome = mkdtempSync(path.join(tmpdir(), `logbook-spawn-plugin-data-${identity.name}-`))
  const pluginData = path.join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
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
    cleanupDirs: [repo, pluginDataHome]
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

const runtimeOf = (teammate: SpawnedTeammate): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: teammate.pluginData } })

const refusalTextOf = (label: string, result: CallToolResult): string => {
  assert.equal(result.isError, true, `${label} expected a refusal, got a success: ${JSON.stringify(result)}`)
  const content = result.content
  assert.ok(Array.isArray(content) && content.length > 0, `${label} returned no content to show the operator`)
  const first = content[0] as { type: string; text?: string }
  assert.equal(first.type, 'text', `${label} returned content the operator cannot read as text`)
  assert.equal(typeof first.text, 'string', `${label} returned a text block with no text`)
  return first.text as string
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

const openThreadFor = async (teammate: SpawnedTeammate, slug: string): Promise<string> => {
  const opened = await callTool(teammate, 'open_thread', {
    title: 'two clones spawn thread',
    slug,
    active_goal: 'exercise the two-clones spawn fixture',
    next_step: 'exercise the two-clones spawn fixture',
    completion_criteria: [
      { text: 'a criterion for the spawn offline-merge scenario', check: 'the offline-merge scenario check', settledness: 'proposed' }
    ]
  })
  assertOkResult(`open_thread (${slug})`, opened)
  return (opened.structuredContent as { thread_id: string }).thread_id
}

const sessionEntryIdsOf = (teammate: SpawnedTeammate, threadId: string): Set<string> =>
  new Set(
    readAllRecordFiles<SessionEntry>(path.join(layoutOf(teammate).records, 'sessions', threadId), SessionRecord).flatMap((slot) =>
      slot.quarantined ? [] : [slot.record.id]
    )
  )

const runSpawnOfflineMergeScenario = (pusherFirst: 'ana' | 'ben'): Promise<void> =>
  withTwoSpawnedClones(async (ana, ben) => {
    const anasThreadId = await openThreadFor(ana, `two-clones-spawn-ana-thread-${pusherFirst}`)
    const bensThreadId = await openThreadFor(ana, `two-clones-spawn-ben-thread-${pusherFirst}`)

    const anaInitialPush = await callTool(ana, 'sync_ledger', {})
    assertOkResult('sync_ledger (ana initial push)', anaInitialPush)

    const benInitialFastForward = await callTool(ben, 'sync_ledger', {})
    assertOkResult('sync_ledger (ben initial fast-forward)', benInitialFastForward)

    ana.goOffline()
    ben.goOffline()

    const anaDecision = await callTool(ana, 'record_decision', {
      thread_id: anasThreadId,
      title: 'ana records a decision offline',
      context: 'ana recorded this while offline',
      options: ['keep it simple', 'add more detail'],
      outcome: 'ana chose to keep it simple'
    })
    assertOkResult('record_decision (ana, offline)', anaDecision)
    const anaDecisionId = (anaDecision.structuredContent as { decision_id: string }).decision_id

    const benDecision = await callTool(ben, 'record_decision', {
      thread_id: bensThreadId,
      title: 'ben records a decision offline',
      context: 'ben recorded this while offline',
      options: ['keep it simple', 'add more detail'],
      outcome: 'ben chose to keep it simple'
    })
    assertOkResult('record_decision (ben, offline)', benDecision)
    const benDecisionId = (benDecision.structuredContent as { decision_id: string }).decision_id

    assert.notEqual(anaDecisionId, benDecisionId)

    const anaEntry = await callTool(ana, 'log_session_event', { thread_id: bensThreadId, actor: 'ana', body: "ana notes something on ben's thread offline" })
    assertOkResult("log_session_event (ana on ben's thread, offline)", anaEntry)
    const anaEntryId = (anaEntry.structuredContent as { session_entry_id: string }).session_entry_id
    const benEntry = await callTool(ben, 'log_session_event', { thread_id: anasThreadId, actor: 'ben', body: "ben notes something on ana's thread offline" })
    assertOkResult("log_session_event (ben on ana's thread, offline)", benEntry)
    const benEntryId = (benEntry.structuredContent as { session_entry_id: string }).session_entry_id

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

    const firstConvergedSync = await callTool(first, 'sync_ledger', {})
    assertOkResult('sync_ledger (first, converge)', firstConvergedSync)

    const firstDecisionSlots = decisionSlotsOf(first)
    const firstSeesSecond = firstDecisionSlots.some(
      (slot) => !slot.quarantined && slot.record.id === secondDecisionId
    )
    assert.equal(firstSeesSecond, true, "convergence: the first teammate's next sync must see the second's decision")

    for (const teammate of [ana, ben]) {
      assert.deepEqual(
        threadRecordOf(teammate, anasThreadId).spine.key_decisions.map((entry) => entry.decision_id),
        [anaDecisionId],
        `nothing lost: ${teammate.name}'s copy of ana's thread must link the decision ana recorded on it`
      )
      assert.deepEqual(
        threadRecordOf(teammate, bensThreadId).spine.key_decisions.map((entry) => entry.decision_id),
        [benDecisionId],
        `nothing lost: ${teammate.name}'s copy of ben's thread must link the decision ben recorded on it`
      )
      assert.equal(sessionEntryIdsOf(teammate, anasThreadId).has(benEntryId), true, `${teammate.name} must hold the session entry ben logged on ana's thread`)
      assert.equal(sessionEntryIdsOf(teammate, bensThreadId).has(anaEntryId), true, `${teammate.name} must hold the session entry ana logged on ben's thread`)
      assertRecordsAreClean(layoutOf(teammate))
    }

    assert.deepEqual(ana.transportErrors, [], 'a real server must never write anything that breaks the stdio transport')
    assert.deepEqual(ben.transportErrors, [], 'a real server must never write anything that breaks the stdio transport')
  })

test('sync.two-clones-offline.spawn', async () => {
  await runSpawnOfflineMergeScenario('ana')
})

test('sync.two-clones-offline.spawn.ben-pushes-first', async () => {
  await runSpawnOfflineMergeScenario('ben')
})

const divergeOneThread = async (
  ana: SpawnedTeammate,
  ben: SpawnedTeammate,
  slug: string,
  bensChange: Record<string, unknown>,
  anasChange: Record<string, unknown>
): Promise<{ threadId: string; anaSync: CallToolResult }> => {
  const threadId = await openThreadFor(ana, slug)
  assertOkResult('sync_ledger (ana initial push)', await callTool(ana, 'sync_ledger', {}))
  assertOkResult('sync_ledger (ben initial fast-forward)', await callTool(ben, 'sync_ledger', {}))
  assertOkResult('update_thread (ben)', await callTool(ben, 'update_thread', { thread_id: threadId, ...bensChange }))
  const benPush = await callTool(ben, 'sync_ledger', {})
  assertOkResult('sync_ledger (ben pushes)', benPush)
  assert.equal((benPush.structuredContent as { action: string }).action, 'pushed')
  assertOkResult('update_thread (ana)', await callTool(ana, 'update_thread', { thread_id: threadId, ...anasChange }))
  return { threadId, anaSync: await callTool(ana, 'sync_ledger', {}) }
}

test('sync.two-clones-changing-different-fields-of-one-thread-conflict-on-that-thread', async () => {
  await withTwoSpawnedClones(async (ana, ben) => {
    const { threadId, anaSync } = await divergeOneThread(
      ana,
      ben,
      'two-clones-different-fields-thread',
      { next_step: 'ben next step' },
      { active_goal: 'ana goal' }
    )
    const text = refusalTextOf('sync_ledger (ana, after both changed one thread)', anaSync)
    assert.match(text, new RegExp(`threads/${threadId}\\.json`), `git merges whole files, so the thread both clones changed must be reported as conflicted:\n${text}`)

    const anasThread = threadRecordOf(ana, threadId)
    assert.equal(anasThread.spine.active_goal, 'ana goal', 'a sync that reports a conflict must write nothing locally')
    assert.equal(anasThread.spine.next_step, 'exercise the two-clones spawn fixture', 'a sync that reports a conflict must not take the remote next step')
  })
})

const CONFLICT_VERSION_SIDES = [
  { label: 'ancestor', goal: 'exercise the two-clones spawn fixture' },
  { label: 'local', goal: 'ana goal' },
  { label: 'remote', goal: 'ben goal' }
] as const

test('sync.a-conflict-reply-gives-every-version-of-the-conflicted-record-and-asks-for-a-review', async () => {
  await withTwoSpawnedClones(async (ana, ben) => {
    const { threadId, anaSync } = await divergeOneThread(
      ana,
      ben,
      'two-clones-conflict-reply-thread',
      { active_goal: 'ben goal' },
      { active_goal: 'ana goal' }
    )
    const text = refusalTextOf('sync_ledger (ana, after both changed the goal)', anaSync)
    assert.match(text, new RegExp(`threads/${threadId}\\.json`), text)

    for (const side of CONFLICT_VERSION_SIDES) {
      const address = new RegExp(`${side.label}: (logbook://conflict/[0-9a-f]{40,64})`).exec(text)?.[1]
      assert.ok(address !== undefined, `the conflict reply must name where to read the ${side.label} version:\n${text}`)
      const version = JSON.parse(await readResourceText(ana.spawned, address)) as Thread
      assert.equal(version.id, threadId)
      assert.equal(version.spine.active_goal, side.goal, `the ${side.label} version must be that side's whole thread`)
    }

    assert.match(text, /review/i, `the reply must direct a review of both versions:\n${text}`)
    assert.match(text, /user/i, `the reply must say when to bring the conflict to the user:\n${text}`)
    assert.doesNotMatch(text, /winner/i, `the reply must not ask for a side to be picked:\n${text}`)

    const unrelatedFile = path.join(ana.repo, 'unrelated.txt')
    writeFileSync(unrelatedFile, 'a blob no conflict names\n')
    const unrelatedBlob = rawGit(ana.repo, ['hash-object', '-w', unrelatedFile]).stdout.trim()
    await assert.rejects(
      readResourceText(ana.spawned, `logbook://conflict/${unrelatedBlob}`),
      'logbook://conflict must serve only the versions the current conflict names'
    )
  })
})

test('sync.names-the-unparseable-record-to-the-operator', async () => {
  await withTwoSpawnedClones(async (ana, ben) => {
    const openedA = await callTool(ana, 'open_thread', {
      title: 'a thread ana pushes before the bad record arrives',
      slug: 'unparseable-record-thread-a',
      active_goal: 'exercise the unparseable-record fixture',
      next_step: 'exercise the unparseable-record fixture',
      completion_criteria: [
        { text: 'a criterion for the unparseable-record scenario', check: 'the unparseable-record scenario check', settledness: 'proposed' }
      ]
    })
    assertOkResult('open_thread (ana, thread a)', openedA)

    const anaInitialPush = await callTool(ana, 'sync_ledger', {})
    assertOkResult('sync_ledger (ana initial push)', anaInitialPush)

    const benFastForward = await callTool(ben, 'sync_ledger', {})
    assertOkResult('sync_ledger (ben initial fast-forward)', benFastForward)

    const badRelPath = 'decisions/not-a-valid-decision-record.json'
    const rawWrite = writeRecords(
      runtimeOf(ben),
      layoutOf(ben),
      [{ kind: 'raw', relPath: badRelPath, content: '{"this is not a valid decision record":true}' }],
      'ben: record a decision the schema will reject'
    )
    assert.equal(rawWrite.ok, true, 'the fixture must be able to seed a record this version cannot parse')

    const benPushesBadRecord = await callTool(ben, 'sync_ledger', {})
    assertOkResult('sync_ledger (ben pushes the unparseable record)', benPushesBadRecord)

    const openedB = await callTool(ana, 'open_thread', {
      title: 'a thread ana opens so her next sync must merge',
      slug: 'unparseable-record-thread-b',
      active_goal: 'exercise the unparseable-record fixture',
      next_step: 'exercise the unparseable-record fixture',
      completion_criteria: [
        { text: 'a criterion that makes ana diverge from the shared copy', check: 'the divergence scenario check', settledness: 'proposed' }
      ]
    })
    assertOkResult('open_thread (ana, thread b)', openedB)

    const anaMerge = await callTool(ana, 'sync_ledger', {})
    const operatorText = refusalTextOf('sync_ledger (ana, merging the unparseable record)', anaMerge)

    assert.ok(
      operatorText.includes(badRelPath),
      `the operator must be told which record file could not be parsed: expected the text to name ${badRelPath}, but it read:\n${operatorText}`
    )
    assert.ok(
      /^retryable: false$/m.test(operatorText),
      `retrying the same call cannot fix bytes that live on the shared copy, so the operator must be told the refusal is not retryable: expected a line reading "retryable: false", but the text read:\n${operatorText}`
    )
    assert.equal(
      /\bpush\b[^\n]*\brejected\b/i.test(operatorText),
      false,
      `no push was attempted on this path, so the operator must not be told a push was rejected, but the text read:\n${operatorText}`
    )
  })
})
