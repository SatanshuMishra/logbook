import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { generateSchemaCases, synthesiseValue, type JsonSchemaNode, type Mutation } from '../support/schema-arbitrary.ts'
import { openStore } from '../../src/store/records.ts'
import type { Decision } from '../../src/schema/decision.ts'
import type { Thread } from '../../src/schema/thread.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'rebuild/dist/bin/logbook-server.js')
const JSON_RPC_FRAMING_PATTERN = /"jsonrpc"\s*:\s*"2\.0"/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Fixture = {
  spawned: SpawnedServer
  repo: string
  pluginData: string
  homeDir: string
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`lifecycle fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-lifecycle-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Lifecycle Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'lifecycle@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook lifecycle fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-lifecycle-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-lifecycle-home-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const published = await listPublishedTools(spawned)
    const raw = await spawned.client.listTools()
    const outputSchemas = new Map<string, Record<string, unknown>>()
    for (const tool of raw.tools) {
      if (isRecord(tool.outputSchema)) {
        outputSchemas.set(tool.name, tool.outputSchema as Record<string, unknown>)
      }
    }
    await fn({ spawned, repo, pluginData, homeDir, published, outputSchemas })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const schemaFor = (tools: PublishedTool[], name: string): JsonSchemaNode => {
  const found = tools.find((t) => t.name === name)
  if (found === undefined) throw new Error(`lifecycle: tool "${name}" was not published`)
  return found.inputSchema
}

const outputSchemaFor = (outputSchemas: Map<string, Record<string, unknown>>, name: string): Record<string, unknown> => {
  const found = outputSchemas.get(name)
  if (found === undefined) throw new Error(`lifecycle: tool "${name}" published no output schema`)
  return found
}

const propOf = (schema: JsonSchemaNode, key: string): JsonSchemaNode => {
  const properties = schema.properties
  if (!isRecord(properties) || !isRecord(properties[key])) {
    throw new Error(`lifecycle: expected published schema to declare property "${key}"`)
  }
  return properties[key] as JsonSchemaNode
}

const enumValuesOf = (node: JsonSchemaNode, path: string): string[] => {
  if (!Array.isArray(node.enum)) throw new Error(`lifecycle: expected ${path} to publish an enum`)
  return node.enum.filter((v): v is string => typeof v === 'string')
}

const typeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const validateAgainstSchema = (schema: Record<string, unknown>, value: unknown, path: string): string[] => {
  const errors: string[] = []
  const declaredType = schema.type
  if (typeof declaredType === 'string') {
    const actual = typeOf(value)
    const matches = declaredType === actual || (declaredType === 'integer' && actual === 'number' && Number.isInteger(value))
    if (!matches) {
      errors.push(`${path}: expected type "${declaredType}", received "${actual}"`)
      return errors
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} is not one of the published enum values`)
  }
  if (declaredType === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (typeof key === 'string' && !(key in value)) {
        errors.push(`${path}.${key}: required property is missing from structuredContent`)
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key}: unexpected property not present in the published output schema`)
        }
      }
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in value && isRecord(propSchema)) {
        errors.push(...validateAgainstSchema(propSchema, value[key], `${path}.${key}`))
      }
    }
  }
  if (declaredType === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((entry, index) => {
      errors.push(...validateAgainstSchema(schema.items as Record<string, unknown>, entry, `${path}[${index}]`))
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

const createFixtureThread = async (
  spawned: SpawnedServer,
  published: PublishedTool[]
): Promise<{ threadId: string; criterionId: string }> => {
  const schema = schemaFor(published, 'open_thread')
  const { valid } = generateSchemaCases('open_thread', schema)
  const result = (await spawned.client.callTool({ name: 'open_thread', arguments: valid })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const firstCriterion = structured.completion_criteria[0]
  assert.ok(firstCriterion !== undefined, 'lifecycle fixture: open_thread arrange call minted no completion criteria')
  return { threadId: structured.thread_id, criterionId: firstCriterion.id }
}

const seedDecision = (repo: string, pluginData: string, homeDir: string, threadId: string): string => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`lifecycle fixture: could not open the store to seed a decision: ${opened.message}`)
  const decision: Decision = {
    id: rt.ulid(),
    thread_id: threadId,
    title: 'fixture decision',
    context: '',
    options: [],
    outcome: '',
    commit: null,
    supersedes: [],
    created_at: rt.now()
  }
  const committed = opened.value.commit([{ kind: 'decision', record: decision }], 'seed fixture decision')
  if (!committed.ok) throw new Error(`lifecycle fixture: could not seed a decision: ${committed.detail}`)
  return decision.id
}

const readStoredThread = (repo: string, pluginData: string, homeDir: string, threadId: string): Thread => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`lifecycle fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`lifecycle fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

const runRejectsInvalid = async (
  fx: Fixture,
  toolName: string,
  overrides: Record<string, unknown> = {}
): Promise<void> => {
  const schema = schemaFor(fx.published, toolName)
  const { mutations } = generateSchemaCases(toolName, schema, overrides)
  assert.ok(mutations.length > 0, `expected at least one generated mutation for ${toolName}`)
  for (const mutation of mutations) {
    const result = (await fx.spawned.client.callTool({ name: toolName, arguments: mutation.input })) as CallToolResult
    assertRefusalNamesField(toolName, mutation, result)
  }
}

test('open_thread.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'open_thread'))
    const schema = schemaFor(fx.published, 'open_thread')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'open_thread')
    const { valid } = generateSchemaCases('open_thread', schema)
    const result = (await fx.spawned.client.callTool({ name: 'open_thread', arguments: valid })) as CallToolResult
    assertOkResult('open_thread', result)
    assertConformsToOutputSchema('open_thread', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('open_thread.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'open_thread')
  })
})

test('update_thread.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'update_thread'))
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const schema = schemaFor(fx.published, 'update_thread')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'update_thread')
    const { valid } = generateSchemaCases('update_thread', schema, { thread_id: threadId })
    const result = (await fx.spawned.client.callTool({ name: 'update_thread', arguments: valid })) as CallToolResult
    assertOkResult('update_thread', result)
    assertConformsToOutputSchema('update_thread', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('update_thread.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'update_thread')
  })
})

test('close_thread.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'close_thread'))
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const schema = schemaFor(fx.published, 'close_thread')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'close_thread')
    const outcomeValues = enumValuesOf(propOf(schema, 'outcome'), 'close_thread.outcome')
    const abandonedOutcome = outcomeValues.find((value) => value !== 'done')
    if (abandonedOutcome === undefined) {
      throw new Error('lifecycle: close_thread.outcome did not publish a non-"done" branch to close through without the done gate')
    }
    const { valid } = generateSchemaCases('close_thread', schema, { thread_id: threadId, outcome: abandonedOutcome })
    const result = (await fx.spawned.client.callTool({ name: 'close_thread', arguments: valid })) as CallToolResult
    assertOkResult('close_thread', result)
    assertConformsToOutputSchema('close_thread', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('close_thread.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const before = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)

    await runRejectsInvalid(fx, 'close_thread')

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.deepEqual(after, before, 'a thread must be left unchanged when every close_thread call it received was refused')
  })
})

test('amend_criteria.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'amend_criteria'))
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const decisionId = seedDecision(fx.repo, fx.pluginData, fx.homeDir, threadId)
    const schema = schemaFor(fx.published, 'amend_criteria')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'amend_criteria')
    const operationValues = enumValuesOf(propOf(schema, 'operation'), 'amend_criteria.operation')
    const insertOperation = operationValues.find((value) => value === 'insert') ?? operationValues[0]
    if (insertOperation === undefined) throw new Error('lifecycle: amend_criteria.operation published no enum values')
    const { valid } = generateSchemaCases('amend_criteria', schema, {
      thread_id: threadId,
      decision_id: decisionId,
      operation: insertOperation,
      text: synthesiseValue(schema, propOf(schema, 'text')),
      kind: synthesiseValue(schema, propOf(schema, 'kind'))
    })
    const result = (await fx.spawned.client.callTool({ name: 'amend_criteria', arguments: valid })) as CallToolResult
    assertOkResult('amend_criteria', result)
    assertConformsToOutputSchema('amend_criteria', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('amend_criteria.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'amend_criteria')
  })
})

test('bind_branch.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'bind_branch'))
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const schema = schemaFor(fx.published, 'bind_branch')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'bind_branch')
    const { valid } = generateSchemaCases('bind_branch', schema, { thread_id: threadId })

    const first = (await fx.spawned.client.callTool({ name: 'bind_branch', arguments: valid })) as CallToolResult
    assertOkResult('bind_branch (first call)', first)
    assertConformsToOutputSchema('bind_branch', outputSchema, first.structuredContent)
    const firstStructured = first.structuredContent as { binding_id: string; created: boolean }
    assert.equal(firstStructured.created, true)

    const second = (await fx.spawned.client.callTool({ name: 'bind_branch', arguments: valid })) as CallToolResult
    assertOkResult('bind_branch (second call)', second)
    assertConformsToOutputSchema('bind_branch', outputSchema, second.structuredContent)
    const secondStructured = second.structuredContent as { binding_id: string; created: boolean }
    assert.equal(secondStructured.created, false, 'binding the same thread/branch pair twice must not create a second binding')
    assert.equal(secondStructured.binding_id, firstStructured.binding_id, 'the second call must report the same binding id')

    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('bind_branch.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'bind_branch')
  })
})
