import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { generateSchemaCases, type ConstraintClass, type JsonSchemaNode, type Mutation } from '../support/schema-arbitrary.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const JSON_RPC_FRAMING_PATTERN = /"jsonrpc"\s*:\s*"2\.0"/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Fixture = {
  spawned: SpawnedServer
  repo: string
  pluginData: string
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`roster fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-roster-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Roster Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'roster@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook roster fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-roster-plugin-data-'))
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
    await fn({ spawned, repo, pluginData, published, outputSchemas })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const schemaFor = (tools: PublishedTool[], name: string): JsonSchemaNode => {
  const found = tools.find((t) => t.name === name)
  if (found === undefined) throw new Error(`roster: tool "${name}" was not published`)
  return found.inputSchema
}

const outputSchemaFor = (outputSchemas: Map<string, Record<string, unknown>>, name: string): Record<string, unknown> => {
  const found = outputSchemas.get(name)
  if (found === undefined) throw new Error(`roster: tool "${name}" published no output schema`)
  return found
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
  if (declaredType === 'object' && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (typeof key === 'string' && !(key in value)) {
        errors.push(`${path}.${key}: required property is missing from structuredContent`)
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

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
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

const runRejectsInvalid = async (
  fx: Fixture,
  toolName: string,
  expectedMissingClasses: readonly ConstraintClass[],
  overrides: Record<string, unknown> = {}
): Promise<void> => {
  const schema = schemaFor(fx.published, toolName)
  const { mutations, missing } = generateSchemaCases(toolName, schema, overrides)
  assert.deepEqual(
    new Set(missing.map((m) => m.class)),
    new Set(expectedMissingClasses),
    `expected ${toolName}'s published schema to carry no mutation for exactly [${expectedMissingClasses.join(', ')}], but it carried none for [${missing.map((m) => m.class).join(', ')}]`
  )
  assert.ok(mutations.length > 0, `expected at least one generated mutation for ${toolName}`)
  for (const mutation of mutations) {
    const result = (await fx.spawned.client.callTool({ name: toolName, arguments: mutation.input })) as CallToolResult
    assertRefusalNamesField(toolName, mutation, result)
  }
}

const openThread = async (spawned: SpawnedServer, published: PublishedTool[], slug: string): Promise<string> => {
  const schema = schemaFor(published, 'open_thread')
  const { valid } = generateSchemaCases('open_thread', schema, {
    title: `roster thread ${slug}`,
    slug,
    completion_criteria: [{ text: 'a roster fixture criterion', check: 'the roster fixture check' }]
  })
  const result = (await spawned.client.callTool({ name: 'open_thread', arguments: valid })) as CallToolResult
  assertOkResult('open_thread (roster fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string }
  return structured.thread_id
}

const callListThreads = async (
  spawned: SpawnedServer,
  overrides: Record<string, unknown> = {}
): Promise<CallToolResult> => (await spawned.client.callTool({ name: 'list_threads', arguments: overrides })) as CallToolResult

test('roster.paginates', async () => {
  await withFixture(async (fx) => {
    const TOTAL = 60
    const PAGE_SIZE = 25
    const seededIds: string[] = []
    for (let index = 0; index < TOTAL; index += 1) {
      seededIds.push(await openThread(fx.spawned, fx.published, `roster-paginate-${index}`))
    }

    const collectedIds: string[] = []
    let cursor: string | null = null
    let pageCount = 0

    while (true) {
      const args: Record<string, unknown> = { limit: PAGE_SIZE }
      if (cursor !== null) args.cursor = cursor
      const result = await callListThreads(fx.spawned, args)
      assertOkResult('list_threads (roster.paginates)', result)
      const structured = result.structuredContent as { threads: { id: string }[]; next_cursor: string | null; total: number }
      assert.equal(structured.total, TOTAL)
      collectedIds.push(...structured.threads.map((row) => row.id))
      pageCount += 1
      if (structured.next_cursor === null) {
        assert.ok(pageCount >= 3, `expected at least three pages over ${TOTAL} threads at ${PAGE_SIZE} per page, got ${pageCount}`)
        break
      }
      cursor = structured.next_cursor
      assert.ok(pageCount < 10, 'roster.paginates: exceeded a sane page count, cursor is likely not advancing')
    }

    assert.equal(collectedIds.length, TOTAL)
    assert.equal(new Set(collectedIds).size, TOTAL, 'every thread id must appear exactly once across the pages')
    for (const id of seededIds) {
      assert.ok(collectedIds.includes(id), `expected seeded thread ${id} to appear somewhere in the paginated roster`)
    }
  })
})

test('list_threads.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'list_threads'))
    const threadId = await openThread(fx.spawned, fx.published, 'list-threads-contract')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'list_threads')
    const result = await callListThreads(fx.spawned, {})
    assertOkResult('list_threads', result)
    assertConformsToOutputSchema('list_threads', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)

    const structured = result.structuredContent as { threads: { id: string }[]; total: number; next_cursor: string | null }
    assert.ok(structured.threads.some((row) => row.id === threadId))
    assert.equal(structured.total, 1, 'exactly one thread was seeded in this fixture, so total must be exactly one')
    assert.equal(structured.next_cursor, null, 'a single-thread roster read on the first page must carry no next cursor')
  })
})

test('list_threads.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'list_threads', ['required', 'maxLength', 'pattern', 'minItems'])
  })
})
