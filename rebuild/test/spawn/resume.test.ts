import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { spawnCountingServer, type CountingServer } from '../support/counting-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import {
  generateSchemaCases,
  type ConstraintClass,
  type JsonSchemaNode,
  type Mutation
} from '../support/schema-arbitrary.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { ULID_PATTERN, ISO_PATTERN } from '../../src/schema/ids.ts'
import { openStore } from '../../src/store/records.ts'
import { escapeStored } from '../../src/render/escape.ts'
import type { Thread } from '../../src/schema/thread.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'rebuild/dist/bin/logbook-server.js')
const JSON_RPC_FRAMING_PATTERN = /"jsonrpc"\s*:\s*"2\.0"/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type EitherServer = SpawnedServer | CountingServer

type Fixture = {
  spawned: SpawnedServer
  repo: string
  pluginData: string
  homeDir: string
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
}

type CountingFixture = {
  spawned: CountingServer
  repo: string
  pluginData: string
  homeDir: string
  published: PublishedTool[]
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`resume fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-resume-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Resume Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'resume@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook resume fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-resume-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-resume-home-'))
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

const withCountingFixture = async (fn: (fx: CountingFixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-resume-counting-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-resume-counting-home-'))
  const spawned = await spawnCountingServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const published = await listPublishedTools(spawned)
    await fn({ spawned, repo, pluginData, homeDir, published })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const schemaFor = (tools: PublishedTool[], name: string): JsonSchemaNode => {
  const found = tools.find((t) => t.name === name)
  if (found === undefined) throw new Error(`resume: tool "${name}" was not published`)
  return found.inputSchema
}

const outputSchemaFor = (outputSchemas: Map<string, Record<string, unknown>>, name: string): Record<string, unknown> => {
  const found = outputSchemas.get(name)
  if (found === undefined) throw new Error(`resume: tool "${name}" published no output schema`)
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
  spawned: EitherServer,
  published: PublishedTool[]
): Promise<{ threadId: string; criterionId: string }> => {
  const schema = schemaFor(published, 'open_thread')
  const { valid } = generateSchemaCases('open_thread', schema)
  const result = (await spawned.client.callTool({ name: 'open_thread', arguments: valid })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const firstCriterion = structured.completion_criteria[0]
  assert.ok(firstCriterion !== undefined, 'resume fixture: open_thread arrange call minted no completion criteria')
  return { threadId: structured.thread_id, criterionId: firstCriterion.id }
}

const callResume = async (spawned: EitherServer, published: PublishedTool[], threadId: string): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'resume_thread')
  const { valid } = generateSchemaCases('resume_thread', schema, { thread_id: threadId })
  return (await spawned.client.callTool({ name: 'resume_thread', arguments: valid })) as CallToolResult
}

const callPark = async (
  spawned: EitherServer,
  published: PublishedTool[],
  overrides: Record<string, unknown>
): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'park_thread')
  const { valid } = generateSchemaCases('park_thread', schema, overrides)
  return (await spawned.client.callTool({ name: 'park_thread', arguments: valid })) as CallToolResult
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

const readStoredThread = (repo: string, pluginData: string, homeDir: string, threadId: string): Thread => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`resume fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`resume fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

const isPointerShaped = (value: unknown): value is { thread_id: string; written_at: string; session_id: string } => {
  if (!isRecord(value)) return false
  return (
    typeof value.thread_id === 'string' &&
    ULID_PATTERN.test(value.thread_id) &&
    typeof value.written_at === 'string' &&
    ISO_PATTERN.test(value.written_at) &&
    typeof value.session_id === 'string' &&
    value.session_id.length > 0
  )
}

const countPointerShapedFiles = (repo: string, pluginData: string, homeDir: string): number => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const layout = layoutFor(rt, repo)
  if (!layout.ok) throw new Error(`resume fixture: could not resolve the store layout to census the state directory: ${layout.message}`)
  const entries = readdirSync(layout.value.state, { withFileTypes: true }).filter((entry) => entry.isFile())
  return entries.filter((entry) => {
    const target = join(layout.value.state, entry.name)
    let raw: string
    try {
      raw = readFileSync(target, 'utf8')
    } catch {
      return false
    }
    try {
      return isPointerShaped(JSON.parse(raw))
    } catch {
      return false
    }
  }).length
}

test('resume_thread.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'resume_thread'))
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'resume_thread')
    const result = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread', result)
    assertConformsToOutputSchema('resume_thread', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('resume_thread.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'resume_thread', ['maxLength', 'minItems'])
  })
})

test('park_thread.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'park_thread'))
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'park_thread')
    const result = await callPark(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread', result)
    assertConformsToOutputSchema('park_thread', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('park_thread.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'park_thread', ['minItems'])
  })
})

test('resume.round-trip', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const firstPark = await callPark(fx.spawned, fx.published, {})
    assertOkResult('park_thread (before any resume)', firstPark)
    const firstStructured = firstPark.structuredContent as { status: string }
    assert.equal(
      firstStructured.status,
      'nothing-to-park',
      'parking before any resume in this session must be a no-op, not a park of the freshly opened thread'
    )

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (round-trip)', resumed)

    const secondPark = await callPark(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread (after resume)', secondPark)
    const secondStructured = secondPark.structuredContent as {
      status: string
      pointer_released: boolean
      parked_thread_ids: string[]
    }
    assert.equal(
      secondStructured.status,
      'parked',
      'a thread resumed this session must be parkable again by the very next park call'
    )
    assert.equal(secondStructured.pointer_released, true)
    assert.ok(secondStructured.parked_thread_ids.includes(threadId))
  })
})

test('resume.idempotent', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const firstResume = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (first)', firstResume)
    const firstStructured = firstResume.structuredContent as { briefing: string }
    assert.ok(typeof firstStructured.briefing === 'string' && firstStructured.briefing.length > 0)

    const secondResume = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (second)', secondResume)
    const secondStructured = secondResume.structuredContent as { briefing: string }
    assert.ok(typeof secondStructured.briefing === 'string' && secondStructured.briefing.length > 0)

    const pointerCount = countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir)
    assert.equal(
      pointerCount,
      1,
      'resuming the same thread twice must leave exactly one pointer record in the state directory, not one per call'
    )
  })
})

test('resume.is-one-call', async () => {
  await withCountingFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const before = fx.spawned.countOf('tools/call')
    const result = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (is-one-call)', result)
    const after = fx.spawned.countOf('tools/call')
    assert.equal(after - before, 1, 'a complete resume must take exactly one tools/call request on the wire')
  })
})

test('resume.unknown-thread', async () => {
  await withFixture(async (fx) => {
    const unknownThreadId = testRuntime().ulid()
    const result = await callResume(fx.spawned, fx.published, unknownThreadId)
    assert.equal(result.isError, true, 'resuming a well-formed but unrecorded thread id must be refused')
    const text = firstTextOf(result)
    const lines = text.split('\n')
    assert.equal(lines[0], 'field: thread_id')
    assert.match(text, new RegExp(unknownThreadId), 'the refusal must name the thread id that could not be resolved')
    assert.match(text, /^retryable: true/m)
  })
})

test('park.is-one-call', async () => {
  await withCountingFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)
    const before = fx.spawned.countOf('tools/call')
    const result = await callPark(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread (is-one-call)', result)
    const after = fx.spawned.countOf('tools/call')
    assert.equal(after - before, 1, 'a complete park must take exactly one tools/call request on the wire')
  })
})

test('park.twice-succeeds', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const firstPark = await callPark(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread (first)', firstPark)
    const firstStructured = firstPark.structuredContent as { status: string }
    assert.equal(firstStructured.status, 'parked')

    const secondPark = await callPark(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread (second)', secondPark)
    const secondStructured = secondPark.structuredContent as {
      status: string
      parked_thread_ids: string[]
      session_entry_ids: string[]
      spine_fields_updated: string[]
      pointer_released: boolean
    }
    assert.equal(secondStructured.status, 'nothing-to-park')
    assert.deepEqual(secondStructured.parked_thread_ids, [])
    assert.deepEqual(secondStructured.session_entry_ids, [])
    assert.deepEqual(secondStructured.spine_fields_updated, [])
    assert.equal(secondStructured.pointer_released, false)
  })
})

test('park.refreshes-the-spine', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const before = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)

    await callResume(fx.spawned, fx.published, threadId)

    const suppliedOutcome = 'wrapped up the spine refresh assertions for this session'
    const suppliedLastSession = 'confirmed the park call updates last_session and next_step only'
    const suppliedNextStep = 'verify the remaining spine fields stay untouched'

    const parked = await callPark(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: suppliedOutcome,
      last_session: suppliedLastSession,
      next_step: suppliedNextStep
    })
    assertOkResult('park_thread (refreshes-the-spine)', parked)
    const structured = parked.structuredContent as { spine_fields_updated: string[] }
    assert.deepEqual(structured.spine_fields_updated, ['last_session', 'next_step'])

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.last_session, escapeStored(suppliedLastSession))
    assert.equal(after.spine.next_step, escapeStored(suppliedNextStep))
    assert.equal(after.spine.active_goal, before.spine.active_goal, 'active_goal must be byte-identical when only last_session and next_step were supplied')
    assert.deepEqual(after.spine.open_risks, before.spine.open_risks, 'open_risks must be untouched by a park call that supplied no risk contribution')
    assert.deepEqual(after.spine.key_decisions, before.spine.key_decisions, 'key_decisions must be untouched by a park call that supplied no decision contribution')
    assert.deepEqual(after.spine.out_of_scope, before.spine.out_of_scope, 'out_of_scope must be untouched by a park call that supplied no out-of-scope contribution')
  })
})

test('handoff.detects-crash', async () => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-resume-handoff-plugin-data-'))
  try {
    let threadId: string
    const p1 = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
    try {
      const published1 = await listPublishedTools(p1)
      const opened = await createFixtureThread(p1, published1)
      threadId = opened.threadId
      const firstResume = await callResume(p1, published1, threadId)
      assertOkResult('resume_thread (handoff step 1)', firstResume)
      const firstStructured = firstResume.structuredContent as { previous_session: unknown }
      assert.equal(
        firstStructured.previous_session,
        null,
        'the very first resume on a fresh store must report no previous session'
      )
    } finally {
      await p1.close()
    }

    const p2 = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
    try {
      const published2 = await listPublishedTools(p2)

      const crashResume = await callResume(p2, published2, threadId)
      assertOkResult('resume_thread (handoff step 3)', crashResume)
      const crashStructured = crashResume.structuredContent as { previous_session: { thread_id: string } | null }
      assert.notEqual(
        crashStructured.previous_session,
        null,
        'a resume in a fresh process must detect the pointer a crashed prior session left behind'
      )
      assert.equal(
        crashStructured.previous_session?.thread_id,
        threadId,
        'the detected previous session must name the thread the crashed session left marked as being worked'
      )

      const secondResume = await callResume(p2, published2, threadId)
      assertOkResult('resume_thread (handoff step 4)', secondResume)
      const secondStructured = secondResume.structuredContent as { previous_session: unknown }
      assert.equal(
        secondStructured.previous_session,
        null,
        'a second resume within the same session must not report itself as a crash of its own prior call'
      )
    } finally {
      await p2.close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
})
