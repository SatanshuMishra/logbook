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

const buildTwoFieldConflict = async (
  ana: SpawnedTeammate,
  ben: SpawnedTeammate,
  slug: string
): Promise<{ threadId: string; anaConflictSync: CallToolResult }> => {
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

  const benUpdate = await callTool(ben, 'update_thread', {
    thread_id: threadId,
    active_goal: 'ben active goal',
    next_step: 'ben next step'
  })
  assertOkResult('update_thread (ben)', benUpdate)

  const benPush = await callTool(ben, 'sync_ledger', {})
  assertOkResult('sync_ledger (ben pushes his edit)', benPush)
  assert.equal((benPush.structuredContent as { action: string }).action, 'pushed')

  const anaUpdate = await callTool(ana, 'update_thread', {
    thread_id: threadId,
    active_goal: 'ana active goal',
    next_step: 'ana next step'
  })
  assertOkResult('update_thread (ana)', anaUpdate)

  const anaConflictSync = await callTool(ana, 'sync_ledger', {})
  assert.equal(anaConflictSync.isError, true, 'expected the second sync to be refused with a real two-field conflict')
  const conflictText = firstTextOf(anaConflictSync)
  assert.match(conflictText, new RegExp(`thread:${threadId} spine\\.active_goal`))
  assert.match(conflictText, new RegExp(`thread:${threadId} spine\\.next_step`))

  return { threadId, anaConflictSync }
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

const writeThreadOf = (teammate: SpawnedTeammate, threadId: string, mutate: (thread: Thread) => Thread): void =>
  plantThreadRecord(teammate, mutate(readThreadOf(teammate, threadId)))

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

const ARTIFACT_CONFLICT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAA'

test('resolve.spine-landed-conflict-resolves', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const threadId = await openAndConvergeThread(ana, ben, 'resolve-spine-landed-thread')

    writeThreadOf(ben, threadId, (thread) => ({ ...thread, spine: { ...thread.spine, landed: 'ben has landed the write path' } }))
    const benPush = await callTool(ben, 'sync_ledger', {})
    assertOkResult('sync_ledger (ben pushes his landed edit)', benPush)
    assert.equal((benPush.structuredContent as { action: string }).action, 'pushed')

    writeThreadOf(ana, threadId, (thread) => ({ ...thread, spine: { ...thread.spine, landed: 'ana has landed the write path' } }))

    const anaConflictSync = await callTool(ana, 'sync_ledger', {})
    assert.equal(anaConflictSync.isError, true, 'expected the second sync to be refused with a spine.landed conflict')
    const conflictText = firstTextOf(anaConflictSync)
    assert.match(conflictText, new RegExp(`thread:${threadId} spine\\.landed`))

    const resolved = await callTool(ana, 'resolve_conflict', {
      resolutions: [{ record: `thread:${threadId}`, field: 'spine.landed', winner: 'local' }]
    })
    assertOkResult('resolve_conflict', resolved)

    const mergedThread = readThreadOf(ana, threadId)
    assert.equal(mergedThread.spine.landed, 'ana has landed the write path', 'the local winner must be applied verbatim')

    const pushedAfterResolve = await callTool(ana, 'sync_ledger', {})
    assertOkResult('sync_ledger (after resolve_conflict, must push)', pushedAfterResolve)
  })
})

test('resolve.artifacts-conflict-resolves', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const threadId = await openAndConvergeThread(ana, ben, 'resolve-artifacts-thread')

    writeThreadOf(ben, threadId, (thread) => ({
      ...thread,
      artifacts: [{ id: ARTIFACT_CONFLICT_ID, label: 'ben plan', pointer: 'docs/plans/ben.md', retired: false }]
    }))
    const benPush = await callTool(ben, 'sync_ledger', {})
    assertOkResult('sync_ledger (ben pushes his artifact edit)', benPush)
    assert.equal((benPush.structuredContent as { action: string }).action, 'pushed')

    writeThreadOf(ana, threadId, (thread) => ({
      ...thread,
      artifacts: [{ id: ARTIFACT_CONFLICT_ID, label: 'ana plan', pointer: 'docs/plans/ana.md', retired: false }]
    }))

    const anaConflictSync = await callTool(ana, 'sync_ledger', {})
    assert.equal(anaConflictSync.isError, true, 'expected the second sync to be refused with an artifacts conflict')
    const conflictText = firstTextOf(anaConflictSync)
    assert.match(conflictText, new RegExp(`thread:${threadId} artifacts\\[${ARTIFACT_CONFLICT_ID}\\]`))

    const resolved = await callTool(ana, 'resolve_conflict', {
      resolutions: [{ record: `thread:${threadId}`, field: `artifacts[${ARTIFACT_CONFLICT_ID}]`, winner: 'remote' }]
    })
    assertOkResult('resolve_conflict', resolved)

    const mergedThread = readThreadOf(ana, threadId)
    assert.deepEqual(
      mergedThread.artifacts,
      [{ id: ARTIFACT_CONFLICT_ID, label: 'ben plan', pointer: 'docs/plans/ben.md', retired: false }],
      'the remote winner must be applied verbatim'
    )

    const pushedAfterResolve = await callTool(ana, 'sync_ledger', {})
    assertOkResult('sync_ledger (after resolve_conflict, must push)', pushedAfterResolve)
  })
})

test('conflict.resolve-names-the-winner', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId } = await buildTwoFieldConflict(ana, ben, 'resolve-names-the-winner-thread')

    const resolved = await callTool(ana, 'resolve_conflict', {
      resolutions: [
        { record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' },
        { record: `thread:${threadId}`, field: 'spine.next_step', winner: 'remote' },
        { record: `thread:${threadId}`, field: 'spine.next_step_criterion_id', winner: 'remote' }
      ]
    })
    assertOkResult('resolve_conflict', resolved)
    const structured = resolved.structuredContent as {
      resolved: { record: string; field: string; winner: string }[]
    }
    assert.deepEqual(structured.resolved, [
      { record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' },
      { record: `thread:${threadId}`, field: 'spine.next_step', winner: 'remote' },
      { record: `thread:${threadId}`, field: 'spine.next_step_criterion_id', winner: 'remote' }
    ])

    const mergedThread = readThreadOf(ana, threadId)
    assert.equal(mergedThread.spine.active_goal, 'ana active goal', 'the local winner must be applied verbatim')
    assert.equal(mergedThread.spine.next_step, 'ben next step', 'the remote winner must be applied verbatim')

    const pushedAfterResolve = await callTool(ana, 'sync_ledger', {})
    assertOkResult('sync_ledger (after resolve_conflict, must push)', pushedAfterResolve)
  })
})

test('conflict.partial-list-refused', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId } = await buildTwoFieldConflict(ana, ben, 'partial-list-refused-thread')

    const partial = await callTool(ana, 'resolve_conflict', {
      resolutions: [{ record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' }]
    })
    assert.equal(partial.isError, true, 'a resolutions list missing a reported disagreement must be refused')
    const text = firstTextOf(partial)
    assert.equal(text.split('\n')[0], 'field: resolutions')
    assert.match(text, new RegExp(`thread:${threadId} spine\\.next_step`), 'the refusal must name the omitted record and field')

    const untouchedThread = readThreadOf(ana, threadId)
    assert.equal(untouchedThread.spine.active_goal, 'ana active goal', 'a refused resolution must not have applied any winner')
    assert.equal(untouchedThread.spine.next_step, 'ana next step', 'a refused resolution must not have applied any winner')
  })
})

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

test('resolve_conflict.spawn.contract', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId } = await buildTwoFieldConflict(ana, ben, 'resolve-conflict-spawn-contract-thread')

    const listed = await ana.spawned.client.listTools()
    assert.ok(listed.tools.some((t) => t.name === 'resolve_conflict'))
    const outputSchemaRaw = listed.tools.find((t) => t.name === 'resolve_conflict')?.outputSchema
    if (!isRecord(outputSchemaRaw)) throw new Error('resolve_conflict published no output schema')

    const result = await callTool(ana, 'resolve_conflict', {
      resolutions: [
        { record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' },
        { record: `thread:${threadId}`, field: 'spine.next_step', winner: 'remote' },
        { record: `thread:${threadId}`, field: 'spine.next_step_criterion_id', winner: 'remote' }
      ]
    })
    assertOkResult('resolve_conflict', result)
    assertConformsToOutputSchema('resolve_conflict', outputSchemaRaw, result.structuredContent)
    assert.doesNotMatch(ana.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

const RECORD_PATTERN_SYNTHESISER_GAP_FIELDS = new Set(['resolutions.0.field', 'resolutions.0.winner'])

test('resolve_conflict.rejects-invalid', async () => {
  await withSpawnFixtureNoRemote(async (fx) => {
    const schema = schemaFor(fx.published, 'resolve_conflict')
    const { mutations, missing } = generateSchemaCases('resolve_conflict', schema, {
      resolutions: [{ record: 'thread:01ARZ3NDEKTSV4RRFFQ69G5FAV', field: 'title', winner: 'local' }]
    })
    assert.deepEqual(
      new Set(missing.map((m) => m.class)),
      new Set([]),
      "expected resolve_conflict's published schema to carry a constraint of every class"
    )
    assert.ok(mutations.length > 0, 'expected at least one generated mutation for resolve_conflict')

    for (const mutation of mutations) {
      const result = (await fx.spawned.client.callTool({ name: 'resolve_conflict', arguments: mutation.input })) as CallToolResult
      assert.equal(
        result.isError,
        true,
        `resolve_conflict mutation "${mutation.field}" (${mutation.class}) should have been refused as a tool error`
      )
      if (RECORD_PATTERN_SYNTHESISER_GAP_FIELDS.has(mutation.field)) {
        const text = firstTextOf(result)
        assert.equal(
          text.split('\n')[0],
          'field: resolutions.0.record',
          "the schema example synthesiser has no entry for resolve_conflict's non-whitelisted record pattern, so every nested-item mutation's fixture record is itself invalid; that pre-existing defect is reported ahead of the field this mutation actually targets"
        )
        continue
      }
      assertRefusalNamesField('resolve_conflict', mutation, result)
    }
  })
})

test('resolve.a-next-step-and-its-criterion-take-one-winner', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const threadId = await openAndConvergeThread(ana, ben, 'resolve-next-step-pair-thread')
    const record = `thread:${threadId}`
    const criterionId = readThreadOf(ana, threadId).completion_criteria[0]?.id
    assert.ok(criterionId !== undefined, 'resolve: the fixture thread minted no criterion')

    assertOkResult(
      'update_thread (ben names the criterion his next step advances)',
      await callTool(ben, 'update_thread', { thread_id: threadId, next_step: 'ben next step', next_step_criterion_id: criterionId })
    )
    assertOkResult('sync_ledger (ben pushes his next step)', await callTool(ben, 'sync_ledger', {}))
    assertOkResult(
      'update_thread (ana replaces the next step)',
      await callTool(ana, 'update_thread', { thread_id: threadId, next_step: 'ana next step' })
    )

    const anaConflictSync = await callTool(ana, 'sync_ledger', {})
    assert.equal(anaConflictSync.isError, true, 'expected the sync to be refused over the next step and its criterion')
    const conflictText = firstTextOf(anaConflictSync)
    assert.match(conflictText, new RegExp(`${record} spine\\.next_step\\b(?!_)`), conflictText)
    assert.match(conflictText, new RegExp(`${record} spine\\.next_step_criterion_id`), `the criterion ben named belongs to his next step, so it must be in dispute with it:\n${conflictText}`)
    assert.match(conflictText, /name the same winner for both/, `the sync refusal must say the two fields take one winner:\n${conflictText}`)

    const halfOnly = await callTool(ana, 'resolve_conflict', {
      resolutions: [{ record, field: 'spine.next_step', winner: 'remote' }]
    })
    assert.equal(halfOnly.isError, true, 'a resolution naming only the next step must be refused')
    assert.match(firstTextOf(halfOnly), /name the same winner for both/, `the missing-winner refusal must say the two fields take one winner:\n${firstTextOf(halfOnly)}`)

    const split = await callTool(ana, 'resolve_conflict', {
      resolutions: [
        { record, field: 'spine.next_step', winner: 'local' },
        { record, field: 'spine.next_step_criterion_id', winner: 'remote' }
      ]
    })
    assert.equal(split.isError, true, 'a next step from one side with the criterion from the other must be refused')
    assert.match(firstTextOf(split), /same winner for both/)
    assert.equal(readThreadOf(ana, threadId).spine.next_step, 'ana next step', 'a refused resolution must not have applied any winner')

    const resolved = await callTool(ana, 'resolve_conflict', {
      resolutions: [
        { record, field: 'spine.next_step', winner: 'remote' },
        { record, field: 'spine.next_step_criterion_id', winner: 'remote' }
      ]
    })
    assertOkResult('resolve_conflict', resolved)
    const merged = readThreadOf(ana, threadId)
    assert.equal(merged.spine.next_step, 'ben next step')
    assert.equal(merged.spine.next_step_criterion_id, criterionId, 'the criterion must arrive with the next step it was written with')
    assertOkResult('sync_ledger (after resolve_conflict, must push)', await callTool(ana, 'sync_ledger', {}))
  })
})

test('resolve.a-pair-member-changed-locally-after-the-refused-sync-is-refused-as-stale', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const threadId = await openAndConvergeThread(ana, ben, 'resolve-next-step-pair-stale-thread')
    const record = `thread:${threadId}`
    const criterionId = readThreadOf(ana, threadId).completion_criteria[0]?.id
    assert.ok(criterionId !== undefined, 'resolve: the fixture thread minted no criterion')

    assertOkResult(
      'update_thread (ben names the criterion for the shared next step)',
      await callTool(ben, 'update_thread', { thread_id: threadId, next_step: 'the shared next step', next_step_criterion_id: criterionId })
    )
    assertOkResult('sync_ledger (ben pushes)', await callTool(ben, 'sync_ledger', {}))
    assertOkResult(
      'update_thread (ana writes the same next step without a criterion)',
      await callTool(ana, 'update_thread', { thread_id: threadId, next_step: 'the shared next step' })
    )
    const anaConflictSync = await callTool(ana, 'sync_ledger', {})
    assert.equal(anaConflictSync.isError, true, 'expected the sync to be refused over the criterion')

    assertOkResult(
      'update_thread (ana changes her next step before resolving)',
      await callTool(ana, 'update_thread', { thread_id: threadId, next_step: 'ana later next step' })
    )

    const reportedFields = [
      ...firstTextOf(anaConflictSync).matchAll(new RegExp(`${record} (spine\\.next_step(?:_criterion_id)?)(?![_a-z])`, 'g'))
    ].map((match) => match[1] as string)
    assert.ok(reportedFields.includes('spine.next_step_criterion_id'), `expected the criterion to be reported in dispute:\n${firstTextOf(anaConflictSync)}`)

    const stale = await callTool(ana, 'resolve_conflict', {
      resolutions: [...new Set(reportedFields)].map((field) => ({ record, field, winner: 'remote' }))
    })
    const stored = readThreadOf(ana, threadId)
    assert.equal(stale.isError, true, `the criterion was recorded against a next step ana has since replaced, so resolving it must be refused, but it stored ${JSON.stringify([stored.spine.next_step, stored.spine.next_step_criterion_id])}`)
    assert.equal(stored.spine.next_step, 'ana later next step')
    assert.equal(Object.hasOwn(stored.spine, 'next_step_criterion_id'), false, 'a refused resolution must not have applied the criterion')
  })
})

const CRITERION_CHANGED_UNDER_THE_SAME_NEXT_STEP = [
  { name: 'named-after-the-sync', bothNameIt: false, anaLaterNamesIt: true },
  { name: 'cleared-after-the-sync', bothNameIt: true, anaLaterNamesIt: false }
] as const

test('resolve.a-criterion-changed-locally-under-an-unchanged-next-step-is-refused-as-stale', async () => {
  for (const scenario of CRITERION_CHANGED_UNDER_THE_SAME_NEXT_STEP) {
    await withTwoSpawnedTeammates(async (ana, ben) => {
      const threadId = await openAndConvergeThread(ana, ben, `resolve-pair-stale-${scenario.name}`)
      const record = `thread:${threadId}`
      const criterionId = readThreadOf(ana, threadId).completion_criteria[0]?.id
      assert.ok(criterionId !== undefined, 'resolve: the fixture thread minted no criterion')
      const named = (nextStep: string, namesIt: boolean): Record<string, unknown> => ({
        thread_id: threadId,
        next_step: nextStep,
        ...(namesIt ? { next_step_criterion_id: criterionId } : {})
      })

      assertOkResult(`update_thread (ben, ${scenario.name})`, await callTool(ben, 'update_thread', named('ben next step', scenario.bothNameIt)))
      assertOkResult(`sync_ledger (ben pushes, ${scenario.name})`, await callTool(ben, 'sync_ledger', {}))
      assertOkResult(`update_thread (ana, ${scenario.name})`, await callTool(ana, 'update_thread', named('ana next step', scenario.bothNameIt)))
      const anaConflictSync = await callTool(ana, 'sync_ledger', {})
      assert.equal(anaConflictSync.isError, true, `expected the sync to be refused over the next step (${scenario.name})`)

      assertOkResult(
        `update_thread (ana rewrites the same next step, ${scenario.name})`,
        await callTool(ana, 'update_thread', named('ana next step', scenario.anaLaterNamesIt))
      )

      const reportedFields = [
        ...firstTextOf(anaConflictSync).matchAll(new RegExp(`${record} (spine\\.next_step(?:_criterion_id)?)(?![_a-z])`, 'g'))
      ].map((match) => match[1] as string)
      const resolved = await callTool(ana, 'resolve_conflict', {
        resolutions: [...new Set(reportedFields)].map((field) => ({ record, field, winner: 'remote' }))
      })
      const stored = readThreadOf(ana, threadId)
      assert.equal(
        resolved.isError,
        true,
        `ana changed the criterion under her next step after the sync, so taking ben's next step must be refused as stale (${scenario.name}), but it stored ${JSON.stringify([stored.spine.next_step, stored.spine.next_step_criterion_id ?? null])}`
      )
      assert.equal(stored.spine.next_step, 'ana next step')
    })
  }
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

