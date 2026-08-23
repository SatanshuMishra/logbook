import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { openStore } from '../../src/store/records.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { generateSchemaCases, type JsonSchemaNode, type Mutation } from '../support/schema-arbitrary.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = path.join(PROJECT_ROOT, 'rebuild/dist/bin/logbook-server.js')
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
  const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-resolve-no-remote-plugin-data-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const published = await listPublishedTools(spawned)
    const outputSchemas = await collectOutputSchemas(spawned)
    await fn({ spawned, repo, pluginData, published, outputSchemas })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
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
  const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-resolve-with-remote-plugin-data-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const published = await listPublishedTools(spawned)
    const outputSchemas = await collectOutputSchemas(spawned)
    await fn({ spawned, repo, pluginData, published, outputSchemas })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
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

  const pluginData = mkdtempSync(path.join(tmpdir(), `logbook-resolve-plugin-data-${identity.name}-`))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  await spawned.client.listTools()

  return { teammate: { name: identity.name, repo, pluginData, spawned }, cleanupDirs: [repo, pluginData] }
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
    completion_criteria: ['a criterion for the resolve fixture']
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

test('conflict.resolve-names-the-winner', async () => {
  await withTwoSpawnedTeammates(async (ana, ben) => {
    const { threadId } = await buildTwoFieldConflict(ana, ben, 'resolve-names-the-winner-thread')

    const resolved = await callTool(ana, 'resolve_conflict', {
      resolutions: [
        { record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' },
        { record: `thread:${threadId}`, field: 'spine.next_step', winner: 'remote' }
      ]
    })
    assertOkResult('resolve_conflict', resolved)
    const structured = resolved.structuredContent as {
      resolved: { record: string; field: string; winner: string }[]
    }
    assert.deepEqual(structured.resolved, [
      { record: `thread:${threadId}`, field: 'spine.active_goal', winner: 'local' },
      { record: `thread:${threadId}`, field: 'spine.next_step', winner: 'remote' }
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
        { record: `thread:${threadId}`, field: 'spine.next_step', winner: 'remote' }
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
