import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { openStore } from '../../src/store/records.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { writeRecords } from '../../src/store/write-path.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import type { Thread } from '../../src/schema/thread.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { generateSchemaCases, type JsonSchemaNode, type Mutation } from '../support/schema-arbitrary.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = path.join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const JSON_RPC_FRAMING_PATTERN = /"jsonrpc"\s*:\s*"2\.0"/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`resolve fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapCommittedRepo = (prefix: string): string => {
  const repo = mkdtempSync(path.join(tmpdir(), `${prefix}-`))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Resolve Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'resolve-fixture@logbook.test'])
  writeFileSync(path.join(repo, 'README.md'), 'logbook resolve fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

type SingleFixture = {
  spawned: SpawnedServer
  repo: string
  pluginData: string
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
}

const collectOutputSchemas = async (spawned: SpawnedServer): Promise<Map<string, Record<string, unknown>>> => {
  const raw = await spawned.client.listTools()
  const outputSchemas = new Map<string, Record<string, unknown>>()
  for (const tool of raw.tools) {
    if (isRecord(tool.outputSchema)) outputSchemas.set(tool.name, tool.outputSchema as Record<string, unknown>)
  }
  return outputSchemas
}

const withSpawnFixtureNoRemote = async (fn: (fx: SingleFixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapCommittedRepo('logbook-resolve-no-remote-repo')
  const pluginDataHome = mkdtempSync(path.join(tmpdir(), 'logbook-resolve-no-remote-plugin-data-'))
  const pluginData = path.join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const published = await listPublishedTools(spawned)
    const outputSchemas = await collectOutputSchemas(spawned)
    await fn({ spawned, repo, pluginData, published, outputSchemas })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const withSpawnFixtureWithRemote = async (fn: (fx: SingleFixture) => Promise<void>): Promise<void> => {
  const remote = mkdtempSync(path.join(tmpdir(), 'logbook-resolve-with-remote-'))
  runSetupStep(remote, ['init', '--bare', '--initial-branch=main'])
  const repo = mkdtempSync(path.join(tmpdir(), 'logbook-resolve-with-remote-repo-'))
  runSetupStep(repo, ['clone', remote, '.'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Resolve Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'resolve-fixture@logbook.test'])
  writeFileSync(path.join(repo, 'README.md'), 'logbook resolve fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  const pluginDataHome = mkdtempSync(path.join(tmpdir(), 'logbook-resolve-with-remote-plugin-data-'))
  const pluginData = path.join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const published = await listPublishedTools(spawned)
    const outputSchemas = await collectOutputSchemas(spawned)
    await fn({ spawned, repo, pluginData, published, outputSchemas })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
}

const schemaFor = (tools: PublishedTool[], name: string): JsonSchemaNode => {
  const found = tools.find((t) => t.name === name)
  if (found === undefined) throw new Error(`resolve: tool "${name}" was not published`)
  return found.inputSchema
}

const outputSchemaFor = (outputSchemas: Map<string, Record<string, unknown>>, name: string): Record<string, unknown> => {
  const found = outputSchemas.get(name)
  if (found === undefined) throw new Error(`resolve: tool "${name}" published no output schema`)
  return found
}

const typeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const validateAgainstSchema = (schema: Record<string, unknown>, value: unknown, at: string): string[] => {
  const errors: string[] = []
  const declaredType = schema.type
  if (typeof declaredType === 'string') {
    const actual = typeOf(value)
    const matches = declaredType === actual || (declaredType === 'integer' && actual === 'number' && Number.isInteger(value))
    if (!matches) {
      errors.push(`${at}: expected type "${declaredType}", received "${actual}"`)
      return errors
    }
  }
  if (declaredType === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (typeof key === 'string' && !(key in value)) {
        errors.push(`${at}.${key}: required property is missing from structuredContent`)
      }
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in value && isRecord(propSchema)) {
        errors.push(...validateAgainstSchema(propSchema, value[key], `${at}.${key}`))
      }
    }
  }
  if (declaredType === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((entry, index) => {
      errors.push(...validateAgainstSchema(schema.items as Record<string, unknown>, entry, `${at}[${index}]`))
    })
  }
  return errors
}

const assertConformsToOutputSchema = (toolName: string, schema: Record<string, unknown>, value: unknown): void => {
  const errors = validateAgainstSchema(schema, value, toolName)
  assert.deepEqual(errors, [], `structuredContent for ${toolName} violates its published output schema:\n${errors.join('\n')}`)
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const assertRefusalNamesField = (toolName: string, mutation: Mutation, result: CallToolResult): void => {
  assert.equal(
    result.isError,
    true,
    `${toolName} mutation "${mutation.field}" (${mutation.class}) should have been refused as a tool error`
  )
  const text = firstTextOf(result)
  const lines = text.split('\n')
  assert.equal(lines[0], `field: ${mutation.field}`, `expected the refusal to name field "${mutation.field}", got "${lines[0]}"`)
  assert.match(text, /^accepted: /m, `${toolName} refusal for "${mutation.field}" is missing the accepted part`)
  assert.match(text, /^example: /m, `${toolName} refusal for "${mutation.field}" is missing the example part`)
  assert.match(text, /^retryable: (true|false)/m, `${toolName} refusal for "${mutation.field}" is missing the retryable part`)
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

type SpawnedTeammate = {
  name: string
  repo: string
  pluginData: string
  spawned: SpawnedServer
}

const provisionSpawnedTeammate = async (
  remote: string,
  identity: { name: string; email: string }
): Promise<{ teammate: SpawnedTeammate; cleanupDirs: string[] }> => {
  const repo = mkdtempSync(path.join(tmpdir(), `logbook-resolve-clone-${identity.name}-`))
  runSetupStep(repo, ['clone', remote, '.'])
  runSetupStep(repo, ['config', 'user.name', identity.name])
  runSetupStep(repo, ['config', 'user.email', identity.email])

  const pluginDataHome = mkdtempSync(path.join(tmpdir(), `logbook-resolve-plugin-data-${identity.name}-`))
  const pluginData = path.join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  await spawned.client.listTools()

  return { teammate: { name: identity.name, repo, pluginData, spawned }, cleanupDirs: [repo, pluginDataHome] }
}

const withTwoSpawnedTeammates = async (
  fn: (ana: SpawnedTeammate, ben: SpawnedTeammate) => Promise<void>
): Promise<void> => {
  const remote = mkdtempSync(path.join(tmpdir(), 'logbook-resolve-remote-'))
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

const callTool = async (
  teammate: SpawnedTeammate,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> => (await teammate.spawned.client.callTool({ name, arguments: args })) as CallToolResult

const readThreadOf = (teammate: SpawnedTeammate, threadId: string) => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: teammate.pluginData } })
  const opened = openStore(rt, teammate.repo)
  if (!opened.ok) throw new Error(`resolve: could not open ${teammate.name}'s store to re-read the thread`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`resolve: thread "${threadId}" could not be re-read from ${teammate.name}'s store`)
  }
  return slot.record
}

const plantThreadRecord = (teammate: SpawnedTeammate, thread: Thread): void => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: teammate.pluginData } })
  const layout = layoutFor(rt, teammate.repo)
  if (!layout.ok) throw new Error(`resolve: layoutFor refused for ${teammate.name} while planting a thread record`)
  const write = writeRecords(
    rt,
    layout.value,
    [{ kind: 'thread', record: { ...thread, updated_at: rt.now() } }],
    `${teammate.name}: plant a thread record for a resolve_conflict fixture`
  )
  if (!write.ok) throw new Error(`resolve: writeRecords failed for ${teammate.name} while planting a thread record: ${write.detail}`)
}

const readDecisionOf = (teammate: SpawnedTeammate, decisionId: string) => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: teammate.pluginData } })
  const opened = openStore(rt, teammate.repo)
  if (!opened.ok) throw new Error(`resolve: could not open ${teammate.name}'s store to read a decision`)
  const slot = opened.value.readDecision(decisionId)
  return slot === null || slot.quarantined ? null : slot.record
}

const readSessionEntryOf = (teammate: SpawnedTeammate, threadId: string, entryId: string) => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: teammate.pluginData } })
  const opened = openStore(rt, teammate.repo)
  if (!opened.ok) throw new Error(`resolve: could not open ${teammate.name}'s store to read a session entry`)
  const slot = opened.value.readSessionEntry(threadId, entryId)
  return slot === null || slot.quarantined ? null : slot.record
}

const openAndConvergeThread = async (ana: SpawnedTeammate, ben: SpawnedTeammate, slug: string): Promise<string> => {
  const opened = await callTool(ana, 'open_thread', {
    title: 'resolve conflict fixture thread',
    slug,
    active_goal: 'exercise the resolve-conflict fixture',
    next_step: 'exercise the resolve-conflict fixture',
    completion_criteria: [{ text: 'a criterion for the resolve fixture', check: 'the resolve fixture check', settledness: 'proposed' }]
  })
  assertOkResult('open_thread', opened)
  const threadId = (opened.structuredContent as { thread_id: string }).thread_id

  assertOkResult('sync_ledger (ana initial push)', await callTool(ana, 'sync_ledger', {}))
  assertOkResult('sync_ledger (ben initial fast-forward)', await callTool(ben, 'sync_ledger', {}))

  return threadId
}

test('sync_ledger.spawn.contract', async () => {
  await withSpawnFixtureWithRemote(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'sync_ledger'))
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'sync_ledger')
    const result = (await fx.spawned.client.callTool({ name: 'sync_ledger', arguments: {} })) as CallToolResult
    assertOkResult('sync_ledger', result)
    assertConformsToOutputSchema('sync_ledger', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('sync_ledger.rejects-invalid', async () => {
  await withSpawnFixtureNoRemote(async (fx) => {
    const schema = schemaFor(fx.published, 'sync_ledger')
    const { mutations, missing } = generateSchemaCases('sync_ledger', schema)
    assert.deepEqual(
      new Set(missing.map((m) => m.class)),
      new Set(['required', 'maxLength', 'pattern', 'minItems', 'wrongType', 'unknownKey']),
      "sync_ledger's published schema is NO_ARGUMENTS, an empty object schema; it carries no constraint the generator can mutate against"
    )
    assert.equal(mutations.length, 0, 'an empty-object schema produces no generated mutations to run')

    const baseline = (await fx.spawned.client.callTool({ name: 'sync_ledger', arguments: {} })) as CallToolResult
    assert.equal(baseline.isError, true, 'expected sync_ledger to refuse when no remote is configured at all')

    const withUnknownKey = (await fx.spawned.client.callTool({
      name: 'sync_ledger',
      arguments: { __logbook_unexpected_field__: true }
    })) as CallToolResult
    assert.deepEqual(
      withUnknownKey,
      baseline,
      'sync_ledger has no strict object schema to violate: an object carrying an unrecognised key is accepted exactly like a call with none, so its outcome must be identical to the baseline call'
    )

    let thrown: unknown = null
    try {
      await fx.spawned.client.callTool({
        name: 'sync_ledger',
        arguments: ['not', 'an', 'object'] as unknown as Record<string, unknown>
      })
    } catch (error) {
      thrown = error
    }
    assert.ok(
      thrown instanceof Error,
      'a non-object arguments value is rejected by the MCP request schema itself before any tool is dispatched, so it can never surface as a CallToolResult from sync_ledger'
    )
    assert.match((thrown as Error).message, /expected record/i)
  })
})

const threadPathOf = (threadId: string): string => `threads/${threadId}.json`

const ledgerCommitOf = (teammate: SpawnedTeammate): string => rawGit(teammate.repo, ['rev-parse', LEDGER_REF]).stdout.trim()

const syncAndExpectConflictOn = async (teammate: SpawnedTeammate, threadId: string, label: string): Promise<void> => {
  const synced = await callTool(teammate, 'sync_ledger', {})
  assert.equal(synced.isError, true, `expected ${label} to be refused over the thread both clones changed`)
  assert.match(firstTextOf(synced), new RegExp(`threads/${threadId}\\.json`), firstTextOf(synced))
}

test('resolve.stores-the-composed-record-and-both-clones-hold-it', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const threadId = await openAndConvergeThread(ana, ben, 'resolve-composed-record-thread')
    const criterionId = readThreadOf(ana, threadId).completion_criteria[0]?.id
    assert.ok(criterionId !== undefined, 'resolve: the fixture thread minted no criterion')

    assertOkResult(
      'update_thread (ben changes the goal, next step and last session)',
      await callTool(ben, 'update_thread', {
        thread_id: threadId,
        active_goal: 'ben goal',
        next_step: 'ben step',
        next_step_criterion_id: criterionId,
        last_session: 'ben session'
      })
    )
    assertOkResult('sync_ledger (ben pushes)', await callTool(ben, 'sync_ledger', {}))
    assertOkResult('update_thread (ana changes only the goal)', await callTool(ana, 'update_thread', { thread_id: threadId, active_goal: 'ana goal' }))
    await syncAndExpectConflictOn(ana, threadId, "ana's sync")

    const bensThread = readThreadOf(ben, threadId)
    const composed: Thread = { ...bensThread, spine: { ...bensThread.spine, active_goal: 'ana goal' } }
    assertOkResult('resolve_conflict', await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] }))
    assertOkResult('sync_ledger (ana pushes the resolution)', await callTool(ana, 'sync_ledger', {}))
    assertOkResult('sync_ledger (ben picks up the resolution)', await callTool(ben, 'sync_ledger', {}))

    for (const teammate of [ana, ben]) {
      assert.deepEqual(readThreadOf(teammate, threadId), composed, `${teammate.name}'s clone must hold exactly the record ana composed from both versions`)
    }
  })
})

const REMOTE_ONLY_RECORDS = [
  {
    name: 'a-new-decision',
    create: async (ben: SpawnedTeammate, threadId: string) => {
      const recorded = await callTool(ben, 'record_decision', {
        thread_id: threadId,
        title: 'ben picks the fast path',
        context: 'a choice ben made while ana was offline',
        options: ['the fast path', 'the safe path'],
        outcome: 'the fast path'
      })
      assertOkResult('record_decision (ben)', recorded)
      const decisionId = (recorded.structuredContent as { decision_id: string }).decision_id
      return (teammate: SpawnedTeammate): boolean => readDecisionOf(teammate, decisionId) !== null
    }
  },
  {
    name: 'a-new-session-entry',
    create: async (ben: SpawnedTeammate, threadId: string) => {
      const logged = await callTool(ben, 'log_session_event', { thread_id: threadId, actor: 'ben', body: 'ben worked the thread while ana was offline' })
      assertOkResult('log_session_event (ben)', logged)
      const entryId = (logged.structuredContent as { session_entry_id: string }).session_entry_id
      return (teammate: SpawnedTeammate): boolean => readSessionEntryOf(teammate, threadId, entryId) !== null
    }
  }
] as const

for (const scenario of REMOTE_ONLY_RECORDS) {
  test(`resolve.settles-a-conflict-while-the-remote-carries-${scenario.name}`, async () => {
    await withTwoSpawnedTeammates(async (ana, ben) => {
      const threadId = await openAndConvergeThread(ana, ben, `resolve-remote-carries-${scenario.name}`)

      const holdsBensRecord = await scenario.create(ben, threadId)
      assertOkResult(`update_thread (ben changes the goal, ${scenario.name})`, await callTool(ben, 'update_thread', { thread_id: threadId, active_goal: 'ben goal' }))
      assertOkResult(`sync_ledger (ben pushes, ${scenario.name})`, await callTool(ben, 'sync_ledger', {}))
      assertOkResult(`update_thread (ana changes the goal, ${scenario.name})`, await callTool(ana, 'update_thread', { thread_id: threadId, active_goal: 'ana goal' }))
      await syncAndExpectConflictOn(ana, threadId, `ana's sync (${scenario.name})`)

      const bensThread = readThreadOf(ben, threadId)
      const composed: Thread = { ...bensThread, spine: { ...bensThread.spine, active_goal: 'ana goal' } }
      assertOkResult(
        `resolve_conflict (${scenario.name})`,
        await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] })
      )

      const anaPush = await callTool(ana, 'sync_ledger', {})
      assertOkResult(`sync_ledger (ana pushes the resolution, ${scenario.name})`, anaPush)
      assert.equal((anaPush.structuredContent as { action: string }).action, 'pushed')
      assertOkResult(`sync_ledger (ben picks up the resolution, ${scenario.name})`, await callTool(ben, 'sync_ledger', {}))

      for (const teammate of [ana, ben]) {
        assert.equal(readThreadOf(teammate, threadId).spine.active_goal, 'ana goal', `${teammate.name}'s clone must hold the composed goal (${scenario.name})`)
        assert.equal(holdsBensRecord(teammate), true, `${teammate.name}'s clone must still hold ${scenario.name} ben pushed (${scenario.name})`)
      }
    })
  })
}

test('resolve.settles-a-conflict-between-ledgers-that-share-no-history', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const opened = await callTool(ana, 'open_thread', {
      title: 'resolve conflict fixture thread',
      slug: 'resolve-unrelated-histories',
      active_goal: 'ana goal',
      next_step: 'exercise the resolve-conflict fixture',
      completion_criteria: [{ text: 'a criterion for the resolve fixture', check: 'the resolve fixture check', settledness: 'proposed' }]
    })
    assertOkResult('open_thread (ana)', opened)
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id
    assertOkResult('sync_ledger (ana pushes)', await callTool(ana, 'sync_ledger', {}))

    const anasThread = readThreadOf(ana, threadId)
    plantThreadRecord(ben, { ...anasThread, spine: { ...anasThread.spine, active_goal: 'ben goal' } })
    await syncAndExpectConflictOn(ben, threadId, "ben's first sync")

    const composed: Thread = { ...anasThread, spine: { ...anasThread.spine, active_goal: 'ben goal, then ana goal' } }
    assertOkResult('resolve_conflict', await callTool(ben, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] }))
    assert.deepEqual(readThreadOf(ben, threadId), composed)
    assertOkResult('sync_ledger (ben pushes the resolution)', await callTool(ben, 'sync_ledger', {}))
  })
})

const setUpGoalConflict = async (ana: SpawnedTeammate, ben: SpawnedTeammate, slug: string): Promise<{ threadId: string; bensThread: Thread }> => {
  const threadId = await openAndConvergeThread(ana, ben, slug)
  assertOkResult('update_thread (ben changes the goal)', await callTool(ben, 'update_thread', { thread_id: threadId, active_goal: 'ben goal' }))
  assertOkResult('sync_ledger (ben pushes)', await callTool(ben, 'sync_ledger', {}))
  assertOkResult('update_thread (ana changes the goal)', await callTool(ana, 'update_thread', { thread_id: threadId, active_goal: 'ana goal' }))
  await syncAndExpectConflictOn(ana, threadId, "ana's sync")
  return { threadId, bensThread: readThreadOf(ben, threadId) }
}

const SHAPE_FAILURES = [
  {
    name: 'a-field-of-the-wrong-type',
    field: 'resolutions.0.record.spine.active_goal',
    break: (thread: Thread): unknown => ({ ...thread, spine: { ...thread.spine, active_goal: 42 } })
  },
  {
    name: 'an-id-that-differs-from-its-path',
    field: 'resolutions.0.record.id',
    break: (thread: Thread): unknown => ({ ...thread, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })
  }
] as const

for (const failure of SHAPE_FAILURES) {
  test(`resolve.refuses-a-composed-record-with-${failure.name}-and-writes-nothing`, async () => {
    await withTwoSpawnedTeammates(async (ana, ben) => {
      const { threadId, bensThread } = await setUpGoalConflict(ana, ben, `resolve-shape-${failure.name}`)
      const before = ledgerCommitOf(ana)

      const refused = await callTool(ana, 'resolve_conflict', {
        resolutions: [{ path: threadPathOf(threadId), record: failure.break(bensThread) }]
      })
      assert.equal(refused.isError, true, `a record that does not fit its stored shape must be refused (${failure.name})`)
      assert.equal(firstTextOf(refused).split('\n')[0], `field: ${failure.field}`, firstTextOf(refused))
      assert.equal(ledgerCommitOf(ana), before, `a refused resolution must leave the ledger where it was (${failure.name})`)

      const composed: Thread = { ...bensThread, spine: { ...bensThread.spine, active_goal: 'ana goal' } }
      assertOkResult(
        `resolve_conflict (a valid record after the refusal, ${failure.name})`,
        await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] })
      )
    })
  })
}

test('resolve.stores-a-next-step-paired-with-the-other-sides-criterion-as-given', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const threadId = await openAndConvergeThread(ana, ben, 'resolve-no-content-rules-thread')
    const criterionId = readThreadOf(ana, threadId).completion_criteria[0]?.id
    assert.ok(criterionId !== undefined, 'resolve: the fixture thread minted no criterion')

    assertOkResult(
      'update_thread (ben names the criterion his next step advances)',
      await callTool(ben, 'update_thread', { thread_id: threadId, next_step: 'ben next step', next_step_criterion_id: criterionId })
    )
    assertOkResult('sync_ledger (ben pushes)', await callTool(ben, 'sync_ledger', {}))
    assertOkResult('update_thread (ana replaces the next step)', await callTool(ana, 'update_thread', { thread_id: threadId, next_step: 'ana next step' }))
    await syncAndExpectConflictOn(ana, threadId, "ana's sync")

    const anasThread = readThreadOf(ana, threadId)
    const composed: Thread = { ...anasThread, spine: { ...anasThread.spine, next_step: 'ana next step', next_step_criterion_id: criterionId } }
    assertOkResult(
      'resolve_conflict (ana pairs her next step with the criterion ben named)',
      await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] })
    )
    assert.deepEqual(readThreadOf(ana, threadId), composed, 'Logbook stores the composed record without judging which criterion a next step advances')
  })
})


test('conflict.partial-list-refused', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const firstThreadId = await openAndConvergeThread(ana, ben, 'partial-list-refused-first-thread')
    const secondThreadId = await openAndConvergeThread(ana, ben, 'partial-list-refused-second-thread')
    for (const threadId of [firstThreadId, secondThreadId]) {
      assertOkResult('update_thread (ben changes a goal)', await callTool(ben, 'update_thread', { thread_id: threadId, active_goal: 'ben goal' }))
    }
    assertOkResult('sync_ledger (ben pushes both goals)', await callTool(ben, 'sync_ledger', {}))
    for (const threadId of [firstThreadId, secondThreadId]) {
      assertOkResult('update_thread (ana changes a goal)', await callTool(ana, 'update_thread', { thread_id: threadId, active_goal: 'ana goal' }))
    }
    await syncAndExpectConflictOn(ana, secondThreadId, "ana's sync over two threads")
    const before = ledgerCommitOf(ana)
    const bensFirstThread = readThreadOf(ben, firstThreadId)
    const composed: Thread = { ...bensFirstThread, spine: { ...bensFirstThread.spine, active_goal: 'ana and ben goal' } }

    const missingOne = await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(firstThreadId), record: composed }] })
    assert.equal(missingOne.isError, true, 'a resolutions list missing a reported file must be refused')
    const text = firstTextOf(missingOne)
    assert.equal(text.split('\n')[0], 'field: resolutions')
    assert.match(text, new RegExp(`threads/${secondThreadId}\\.json`), `the refusal must name the omitted file:\n${text}`)

    const unreported = await callTool(ana, 'resolve_conflict', {
      resolutions: [
        { path: threadPathOf(firstThreadId), record: composed },
        { path: threadPathOf(secondThreadId), record: readThreadOf(ben, secondThreadId) },
        { path: 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json', record: composed }
      ]
    })
    assert.equal(unreported.isError, true, 'a resolutions list naming a file sync_ledger did not report must be refused')
    assert.equal(firstTextOf(unreported).split('\n')[0], 'field: resolutions.2.path', firstTextOf(unreported))

    assert.equal(ledgerCommitOf(ana), before, 'a refused resolution must leave the ledger where it was')
    assert.equal(readThreadOf(ana, firstThreadId).spine.active_goal, 'ana goal', 'a refused resolution must not store any record')
  })
})

test('resolve_conflict.spawn.contract', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId, bensThread } = await setUpGoalConflict(ana, ben, 'resolve-conflict-spawn-contract-thread')

    const listed = await ana.spawned.client.listTools()
    assert.ok(listed.tools.some((t) => t.name === 'resolve_conflict'))
    const outputSchemaRaw = listed.tools.find((t) => t.name === 'resolve_conflict')?.outputSchema
    if (!isRecord(outputSchemaRaw)) throw new Error('resolve_conflict published no output schema')

    const composed: Thread = { ...bensThread, spine: { ...bensThread.spine, active_goal: 'ana goal' } }
    const result = await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] })
    assertOkResult('resolve_conflict', result)
    assertConformsToOutputSchema('resolve_conflict', outputSchemaRaw, result.structuredContent)
    const structured = result.structuredContent as { resolved: string[]; commit: string }
    assert.deepEqual(structured.resolved, [threadPathOf(threadId)])
    assert.equal(structured.commit, ledgerCommitOf(ana))
    assert.doesNotMatch(ana.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('resolve_conflict.rejects-invalid', async () => {
  await withSpawnFixtureNoRemote(async (fx) => {
    const schema = schemaFor(fx.published, 'resolve_conflict')
    const { mutations, missing } = generateSchemaCases('resolve_conflict', schema, {
      resolutions: [{ path: 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json', record: {} }]
    })
    assert.deepEqual(
      new Set(missing.map((m) => m.class)),
      new Set([]),
      "expected resolve_conflict's published schema to carry a constraint of every class"
    )
    assert.ok(mutations.length > 0, 'expected at least one generated mutation for resolve_conflict')

    for (const mutation of mutations) {
      const result = (await fx.spawned.client.callTool({ name: 'resolve_conflict', arguments: mutation.input })) as CallToolResult
      assertRefusalNamesField('resolve_conflict', mutation, result)
    }
  })
})

const plantRawFile = (teammate: SpawnedTeammate, relPath: string, content: string): void => {
  const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: teammate.pluginData } })
  const layout = layoutFor(rt, teammate.repo)
  if (!layout.ok) throw new Error(`resolve: layoutFor refused for ${teammate.name} while planting a file`)
  const write = writeRecords(rt, layout.value, [{ kind: 'raw', relPath, content }], `${teammate.name}: plant a file outside the record directories`)
  if (!write.ok) throw new Error(`resolve: writeRecords failed for ${teammate.name} while planting a file: ${write.detail}`)
}

const ledgerFileOf = (teammate: SpawnedTeammate, relPath: string): string =>
  rawGit(teammate.repo, ['cat-file', 'blob', `${LEDGER_REF}:${relPath}`]).stdout

test('resolve.stores-a-conflicted-file-outside-the-record-directories-as-the-text-given', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const notePath = 'notes/team.txt'
    plantRawFile(ana, notePath, 'the shared note\n')
    assertOkResult('sync_ledger (ana pushes the note)', await callTool(ana, 'sync_ledger', {}))
    assertOkResult('sync_ledger (ben picks up the note)', await callTool(ben, 'sync_ledger', {}))

    plantRawFile(ben, notePath, 'ben rewrote the note\n')
    assertOkResult('sync_ledger (ben pushes his note)', await callTool(ben, 'sync_ledger', {}))
    plantRawFile(ana, notePath, 'ana rewrote the note\n')
    const refused = await callTool(ana, 'sync_ledger', {})
    assert.equal(refused.isError, true, 'expected the note both clones rewrote to conflict')
    assert.match(firstTextOf(refused), /notes\/team\.txt/, firstTextOf(refused))

    const asRecord = await callTool(ana, 'resolve_conflict', { resolutions: [{ path: notePath, record: { text: 'ana and ben' } }] })
    assert.equal(asRecord.isError, true, 'a file outside the record directories must be settled with content, not a record')
    assert.equal(firstTextOf(asRecord).split('\n')[0], 'field: resolutions.0.content', firstTextOf(asRecord))

    const composed = '# ana rewrote the note\nand ben rewrote it too\n'
    assertOkResult('resolve_conflict', await callTool(ana, 'resolve_conflict', { resolutions: [{ path: notePath, content: composed }] }))
    assertOkResult('sync_ledger (ana pushes the resolution)', await callTool(ana, 'sync_ledger', {}))
    assertOkResult('sync_ledger (ben picks up the resolution)', await callTool(ben, 'sync_ledger', {}))

    for (const teammate of [ana, ben]) {
      assert.equal(ledgerFileOf(teammate, notePath), composed, `${teammate.name}'s ledger must hold the note exactly as ana gave it`)
    }
  })
})

test('resolve.keeps-a-local-change-to-another-file-made-after-the-refused-sync', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId, bensThread } = await setUpGoalConflict(ana, ben, 'resolve-local-change-elsewhere-thread')
    const logged = await callTool(ana, 'log_session_event', { thread_id: threadId, actor: 'ana', body: 'ana noted something while reviewing' })
    assertOkResult('log_session_event (ana, while reviewing)', logged)
    const entryId = (logged.structuredContent as { session_entry_id: string }).session_entry_id

    const composed: Thread = { ...bensThread, spine: { ...bensThread.spine, active_goal: 'ana goal' } }
    assertOkResult(
      'resolve_conflict (after a local session entry)',
      await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] })
    )
    assert.notEqual(readSessionEntryOf(ana, threadId, entryId), null, "the session entry ana logged while reviewing must be kept")
    assertOkResult('sync_ledger (ana pushes the resolution)', await callTool(ana, 'sync_ledger', {}))
    assertOkResult('sync_ledger (ben picks up the resolution)', await callTool(ben, 'sync_ledger', {}))
    assert.notEqual(readSessionEntryOf(ben, threadId, entryId), null, "ben's clone must hold the entry ana logged while reviewing")
  })
})

test('resolve.refuses-when-a-conflicted-record-changed-locally-after-the-refused-sync', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId, bensThread } = await setUpGoalConflict(ana, ben, 'resolve-stale-conflict-thread')
    assertOkResult('update_thread (ana changes the goal again)', await callTool(ana, 'update_thread', { thread_id: threadId, active_goal: 'ana later goal' }))
    const before = ledgerCommitOf(ana)

    const composed: Thread = { ...bensThread, spine: { ...bensThread.spine, active_goal: 'ana goal' } }
    const stale = await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] })
    assert.equal(stale.isError, true, 'the version ana reviewed is no longer her local version, so the resolution must be refused')
    assert.match(firstTextOf(stale), /call sync_ledger again/, firstTextOf(stale))
    assert.equal(ledgerCommitOf(ana), before, 'a stale resolution must leave the ledger where it was')
    assert.equal(readThreadOf(ana, threadId).spine.active_goal, 'ana later goal')

    await syncAndExpectConflictOn(ana, threadId, "ana's sync after the stale refusal")
    assertOkResult('resolve_conflict (after syncing again)', await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] }))
  })
})

test('resolve.escapes-a-composed-record-as-the-writing-tools-would', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId, bensThread } = await setUpGoalConflict(ana, ben, 'resolve-escapes-thread')
    const composed: Thread = { ...bensThread, spine: { ...bensThread.spine, active_goal: '# ana <goal>' } }
    assertOkResult('resolve_conflict', await callTool(ana, 'resolve_conflict', { resolutions: [{ path: threadPathOf(threadId), record: composed }] }))
    const stored = readThreadOf(ana, threadId)
    assert.equal(stored.spine.active_goal, 'U+0023 ana U+003Cgoal>', 'the composed goal must be stored escaped, as update_thread stores it')
    assert.equal(stored.id, threadId)
    assert.equal(stored.slug, bensThread.slug)
  })
})
