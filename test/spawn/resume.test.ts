import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
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
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { ULID_PATTERN, ISO_PATTERN } from '../../src/schema/ids.ts'
import { openStore } from '../../src/store/records.ts'
import { escapeStored } from '../../src/render/escape.ts'
import type { Thread } from '../../src/schema/thread.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
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
  published: PublishedTool[],
  overrides: Record<string, unknown> = {}
): Promise<{ threadId: string; criterionId: string }> => {
  const schema = schemaFor(published, 'open_thread')
  const { valid } = generateSchemaCases('open_thread', schema, overrides)
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

const callParkWithoutOutcome = async (
  spawned: EitherServer,
  published: PublishedTool[],
  overrides: Record<string, unknown>
): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'park_thread')
  const { valid } = generateSchemaCases('park_thread', schema, overrides)
  assert.equal(
    'outcome' in valid,
    false,
    'a pointer-release call must carry no outcome; park_thread.outcome is still a required property of the published schema'
  )
  return (await spawned.client.callTool({ name: 'park_thread', arguments: valid })) as CallToolResult
}

const callClose = async (
  spawned: EitherServer,
  published: PublishedTool[],
  overrides: Record<string, unknown>
): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'close_thread')
  const { valid } = generateSchemaCases('close_thread', schema, overrides)
  return (await spawned.client.callTool({ name: 'close_thread', arguments: valid })) as CallToolResult
}

const layoutInFixture = (repo: string, pluginData: string, homeDir: string): StoreLayout => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const layout = layoutFor(rt, repo)
  if (!layout.ok) throw new Error(`resume fixture: could not resolve the store layout: ${layout.message}`)
  return layout.value
}

const threadRecordPath = (layout: StoreLayout, threadId: string): string =>
  join(layout.records, 'threads', `${threadId}.json`)

const decisionRecordPath = (layout: StoreLayout, decisionId: string): string =>
  join(layout.records, 'decisions', `${decisionId}.json`)

const sessionEntriesDir = (layout: StoreLayout, threadId: string): string =>
  join(layout.records, 'sessions', threadId)

const pointerFilePath = (layout: StoreLayout): string => join(layout.state, 'active-thread.json')

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

const readSessionBodies = (repo: string, pluginData: string, homeDir: string, threadId: string): string[] => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`resume fixture: could not open the store to read session entries: ${opened.message}`)
  return opened.value.readSessionEntries(threadId).flatMap((slot) => (slot.quarantined ? [] : [slot.record.body]))
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

const STATE_DIR_NON_POINTER_SENTINELS = new Set(['origin.json', 'last-synced', 'last-materialised'])

const countPointerShapedFiles = (repo: string, pluginData: string, homeDir: string): number => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const layout = layoutFor(rt, repo)
  if (!layout.ok) throw new Error(`resume fixture: could not resolve the store layout to census the state directory: ${layout.message}`)
  const entries = readdirSync(layout.value.state, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && !STATE_DIR_NON_POINTER_SENTINELS.has(entry.name)
  )
  return entries.filter((entry) => {
    const target = join(layout.value.state, entry.name)
    let raw: string
    try {
      raw = readFileSync(target, 'utf8')
    } catch (error) {
      throw new Error(`countPointerShapedFiles: could not read ${target}: ${(error as Error).message}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`countPointerShapedFiles: ${target} is not valid JSON and cannot be classified: ${(error as Error).message}`)
    }
    return isPointerShaped(parsed)
  }).length
}

test('resume_thread.spawn.contract', async () => {
  await withFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'resume_thread'))
    const fixtureTitle = 'resume wiring proof thread'
    const fixtureCriterion = 'prove resume_thread renders this exact criterion text'
    const { threadId } = await createFixtureThread(fx.spawned, fx.published, {
      title: fixtureTitle,
      slug: 'resume-wiring-proof',
      completion_criteria: [{ text: fixtureCriterion, check: 'the resume wiring proof check' }]
    })
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'resume_thread')
    const result = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread', result)
    assertConformsToOutputSchema('resume_thread', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)

    const structured = result.structuredContent as { briefing: string }
    assert.ok(
      structured.briefing.includes(`**Thread:** ${fixtureTitle}`),
      'the returned briefing must carry the resumed thread\'s own title, proving it was rendered rather than stubbed'
    )
    assert.ok(
      structured.briefing.includes(fixtureCriterion),
      'the returned briefing must carry the resumed thread\'s own completion criterion text'
    )
    assert.ok(
      structured.briefing.includes('**Currently being worked:** yes'),
      'the returned briefing must reflect the pointer this same resume call just wrote'
    )
  })
})

test('resume.decision-integrity-reports-resolved-dangling-and-quarantined-end-to-end', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a resolvable decision for the resume integrity probe',
        context: 'the probe needs one decision that resolves cleanly through resume_thread',
        options: ['record it plainly'],
        outcome: 'record it plainly'
      }
    })) as CallToolResult
    assertOkResult('record_decision (resume integrity probe, resolved)', recorded)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
    const danglingDecisionId = rt.ulid()
    const quarantinedDecisionId = rt.ulid()
    mkdirSync(join(layout.records, 'decisions'), { recursive: true })
    writeFileSync(decisionRecordPath(layout, quarantinedDecisionId), '{not-json', 'utf8')

    const opened = openStore(rt, fx.repo)
    assert.equal(opened.ok, true, 'resume integrity probe fixture must be able to open the store')
    if (!opened.ok) return

    const thread = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    const withExtraLinks = {
      ...thread,
      spine: {
        ...thread.spine,
        key_decisions: [
          ...thread.spine.key_decisions,
          { id: rt.ulid(), decision_id: danglingDecisionId, title: 'a dangling link', scope: 'resume-integrity-probe' },
          { id: rt.ulid(), decision_id: quarantinedDecisionId, title: 'a quarantined link', scope: 'resume-integrity-probe' }
        ]
      }
    }
    const seeded = opened.value.commit(
      [{ kind: 'thread', record: withExtraLinks }],
      'seed a dangling and a quarantined key-decision link for the resume integrity probe'
    )
    assert.equal(seeded.ok, true, 'resume integrity probe fixture must be able to seed the extra links')

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (decision integrity, end to end)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    const lines = briefing.split('\n')
    const decisionsAt = lines.indexOf('**Decisions:**')
    assert.notEqual(decisionsAt, -1, 'the briefing must carry a Decisions section')
    assert.equal(lines[decisionsAt + 1], '- resolved: 1')
    assert.equal(lines[decisionsAt + 2], `- dangling: ${danglingDecisionId}`)
    assert.equal(lines[decisionsAt + 3], `- quarantined: ${quarantinedDecisionId}`)
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
    const result = await callPark(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: 'the contract fixture session outcome'
    })
    assertOkResult('park_thread', result)
    assertConformsToOutputSchema('park_thread', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('park_thread.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'park_thread', ['minItems', 'required'])
  })
})

test('resume.round-trip', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const firstPark = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (before any resume)', firstPark)
    const firstStructured = firstPark.structuredContent as { status: string }
    assert.equal(
      firstStructured.status,
      'nothing-to-park',
      'parking with no outcome before any resume in this session must be a no-op, not a park of the freshly opened thread; the no-op is preserved only because nothing was supplied to lose, and the same call carrying an outcome must refuse instead of discarding it'
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

test('park.refuses-an-outcome-when-nothing-is-marked-as-being-worked', async () => {
  await withFixture(async (fx) => {
    await createFixtureThread(fx.spawned, fx.published)

    const park = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-NOTHING-TO-PARK this text must survive the refusal'
    })

    assert.equal(park.isError, true, 'park_thread must refuse an outcome when no thread is marked as being worked')
    const text = firstTextOf(park)
    assert.equal(text.split('\n')[0], 'field: outcome')
    assert.match(text, /no thread is currently marked as being worked/)
    assert.match(text, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      0,
      'a refusal on the no-pointer branch must leave the state directory exactly as it found it'
    )
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

    const secondPark = await callParkWithoutOutcome(fx.spawned, fx.published, { thread_id: threadId })
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
    const suppliedNextStep = 'verify the remaining spine fields stay untouched'

    const parked = await callPark(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: suppliedOutcome,
      next_step: suppliedNextStep
    })
    assertOkResult('park_thread (refreshes-the-spine)', parked)
    const structured = parked.structuredContent as { spine_fields_updated: string[] }
    assert.deepEqual(structured.spine_fields_updated, ['next_step'])

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.next_step, escapeStored(suppliedNextStep))
    assert.equal(after.spine.last_session, before.spine.last_session, 'last_session must be byte-identical; park_thread no longer writes it')
    assert.equal(after.spine.active_goal, before.spine.active_goal, 'active_goal must be byte-identical when only next_step was supplied')
    assert.deepEqual(after.spine.open_risks, before.spine.open_risks, 'open_risks must be untouched by a park call that supplied no risk contribution')
    assert.deepEqual(after.spine.key_decisions, before.spine.key_decisions, 'key_decisions must be untouched by a park call that supplied no decision contribution')
    assert.deepEqual(after.spine.out_of_scope, before.spine.out_of_scope, 'out_of_scope must be untouched by a park call that supplied no out-of-scope contribution')
  })
})

test('park.refuses-a-last-session-argument', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const parkSchema = schemaFor(fx.published, 'park_thread')
    const properties = (parkSchema as { properties?: Record<string, unknown> }).properties ?? {}
    assert.equal(
      Object.prototype.hasOwnProperty.call(properties, 'last_session'),
      false,
      'park_thread must no longer publish a last_session argument'
    )

    const result = (await fx.spawned.client.callTool({
      name: 'park_thread',
      arguments: { thread_id: threadId, outcome: 'this call supplies a field the tool no longer accepts', last_session: 'a hand-written summary' }
    })) as CallToolResult
    assert.equal(result.isError, true, 'park_thread must refuse a call carrying last_session')
    assert.match(JSON.stringify(result.content), /last_session/, 'the refusal must name the field that was wrong')

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.last_session, '', 'a refused park call must write nothing')

    const outputSchema = outputSchemaFor(fx.outputSchemas, 'park_thread')
    const outputProperties = outputSchema.properties as Record<string, unknown>
    const updated = outputProperties.spine_fields_updated as { items?: { enum?: unknown } }
    assert.deepEqual(
      updated.items?.enum,
      ['next_step'],
      'park_thread must publish next_step as the only spine field its reply can report'
    )
  })
})
test('resume.last-session-renders-the-previous-sessions-entries-newest-first', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const firstBody = 'MARKER-ENTRY-ONE read the spec and located the derivation point'
    const secondBody = 'MARKER-ENTRY-TWO wrote the segmentation rule'
    const outcome = 'MARKER-PARK closed out the session with the derivation landed'

    const entryIds: string[] = []
    for (const body of [firstBody, secondBody]) {
      const logged = (await fx.spawned.client.callTool({
        name: 'log_session_event',
        arguments: { thread_id: threadId, actor: 'claude', body }
      })) as CallToolResult
      assertOkResult('log_session_event', logged)
      entryIds.push((logged.structuredContent as { session_entry_id: string }).session_entry_id)
    }

    const parked = await callPark(fx.spawned, fx.published, { thread_id: threadId, outcome })
    assertOkResult('park_thread (last-session derivation)', parked)
    const parkEntryIds = (parked.structuredContent as { session_entry_ids: string[] }).session_entry_ids
    const parkEntryId = parkEntryIds[0]
    assert.ok(parkEntryId !== undefined, 'the park call must have written a session log entry')

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (last-session derivation)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    const lines = briefing.split('\n')
    const headingAt = lines.indexOf('**Last session:**')
    assert.notEqual(headingAt, -1, 'the briefing must carry a Last session heading')

    assert.deepEqual(
      lines.slice(headingAt + 2, headingAt + 5),
      [`- ${parkEntryId} ${outcome}`, `- ${entryIds[1]} ${secondBody}`, `- ${entryIds[0]} ${firstBody}`],
      'the Last session section must render the previous session entries newest first, each with its entry id'
    )
  })
})

test('resume.last-session-falls-back-to-the-stored-text-marked-as-legacy', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const storedSummary = 'MARKER-LEGACY a summary typed by hand before the derivation existed'

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, last_session: storedSummary }
    })) as CallToolResult
    assertOkResult('update_thread (legacy last session)', updated)

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (legacy last session)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    const lines = briefing.split('\n')
    const headingAt = lines.indexOf('**Last session:**')
    assert.notEqual(headingAt, -1, 'the briefing must carry a Last session heading')

    assert.deepEqual(
      lines.slice(headingAt + 2, headingAt + 4),
      [
        '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead',
        storedSummary
      ],
      'with no session log entries the stored text must render, marked as legacy'
    )
  })
})

test('park.control-a-held-pointer-still-stores-the-outcome', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const marker = 'MARKER-HAPPY-PATH-PARKED this text must be on disk afterwards'
    const park = await callPark(fx.spawned, fx.published, { thread_id: threadId, outcome: marker })

    assertOkResult('park_thread (control, pointer held)', park)
    const structured = park.structuredContent as { status: string; session_entry_ids: string[] }
    assert.equal(structured.status, 'parked')
    assert.equal(structured.session_entry_ids.length, 1, 'a park with an outcome must write exactly one session entry')

    const bodies = readSessionBodies(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(
      bodies.some((body) => body.includes(marker)),
      true,
      'the outcome supplied to a park with a held pointer must be readable from the stored session log'
    )
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
      const stepFailures: string[] = []

      try {
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
      } catch (error) {
        stepFailures.push(`handoff step 3: ${(error as Error).message}`)
      }

      try {
        const secondResume = await callResume(p2, published2, threadId)
        assertOkResult('resume_thread (handoff step 4)', secondResume)
        const secondStructured = secondResume.structuredContent as { previous_session: unknown }
        assert.equal(
          secondStructured.previous_session,
          null,
          'a second resume within the same session must not report itself as a crash of its own prior call'
        )
      } catch (error) {
        stepFailures.push(`handoff step 4: ${(error as Error).message}`)
      }

      assert.equal(stepFailures.length, 0, stepFailures.join(' | '))
    } finally {
      await p2.close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test('park.refuses-a-different-thread-id-and-keeps-the-pointer', async () => {
  await withFixture(async (fx) => {
    const a = await createFixtureThread(fx.spawned, fx.published, { slug: 'mismatch-thread-a' })
    const b = await createFixtureThread(fx.spawned, fx.published, { slug: 'mismatch-thread-b' })
    await callResume(fx.spawned, fx.published, a.threadId)

    const refused = await callPark(fx.spawned, fx.published, {
      thread_id: b.threadId,
      outcome: 'MARKER-NOT-THE-WORKED-THREAD this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome aimed at a thread that is not the worked one')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, new RegExp(a.threadId), 'the refusal must name the thread that is actually being worked')
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the mismatched-thread branch must leave the pointer in place'
    )

    const mismatched = await callParkWithoutOutcome(fx.spawned, fx.published, { thread_id: b.threadId })
    assertOkResult('park_thread (mismatched id, no outcome)', mismatched)
    const structured = mismatched.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'not-the-worked-thread')
    assert.equal(structured.pointer_released, false)

    const followUp = await callPark(fx.spawned, fx.published, {
      thread_id: a.threadId,
      outcome: 'the mismatch fixture session outcome'
    })
    assertOkResult('park_thread (a still holds the pointer)', followUp)
    const followUpStructured = followUp.structuredContent as { status: string; parked_thread_ids: string[] }
    assert.equal(followUpStructured.status, 'parked')
    assert.ok(followUpStructured.parked_thread_ids.includes(a.threadId))
  })
})

test('park.releases-a-stale-pointer-when-the-thread-record-is-gone', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    unlinkSync(threadRecordPath(layout, threadId))

    const refused = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-STALE-POINTER this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome when the worked thread has no stored record')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, new RegExp(threadId), 'the refusal must name the thread whose record is gone')
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the missing-record branch must leave the pointer in place so the call can be retried'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (stale pointer)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'stale-pointer-released')
    assert.equal(structured.pointer_released, true)
  })
})

test('park.refuses-a-quarantined-thread-record', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    writeFileSync(threadRecordPath(layout, threadId), '{not-json', 'utf8')

    const park = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-QUARANTINE this text must survive the refusal'
    })
    assert.equal(park.isError, true, 'parking a thread whose stored record is quarantined must be refused')
    const text = firstTextOf(park)
    assert.equal(text.split('\n')[0], 'field: outcome')
    assert.match(text, new RegExp(threadId), 'the refusal must name the thread id that could not be resolved')
    assert.match(text, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the quarantined-record branch must leave the pointer in place so the call can be retried'
    )
  })
})

test('park.releases-a-pointer-that-names-a-quarantined-record', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    writeFileSync(threadRecordPath(layout, threadId), '{not-json', 'utf8')

    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'the fixture must start with the pointer naming the quarantined record'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (quarantined record, no outcome)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'quarantined-pointer-released')
    assert.equal(structured.pointer_released, true)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      0,
      'a pointer naming a quarantined record must have a designed release, not only the side effect of resuming an unrelated thread'
    )
  })
})

test('park.releases-the-pointer-when-the-thread-is-already-terminal', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const closed = await callClose(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: 'abandoned',
      detail: 'no longer needed for this test'
    })
    assertOkResult('close_thread (terminal setup)', closed)

    const beforePark = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)

    const refused = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-TERMINAL-POINTER this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome when the worked thread is already terminal')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, /which is terminal/)
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the terminal-thread branch must leave the pointer in place so the call can be retried'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (terminal pointer)', park)
    const structured = park.structuredContent as {
      status: string
      pointer_released: boolean
      parked_thread_ids: string[]
      session_entry_ids: string[]
      spine_fields_updated: string[]
    }
    assert.equal(structured.status, 'terminal-pointer-released')
    assert.equal(structured.pointer_released, true)
    assert.deepEqual(structured.parked_thread_ids, [])
    assert.deepEqual(structured.session_entry_ids, [])
    assert.deepEqual(structured.spine_fields_updated, [])

    const afterPark = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.deepEqual(afterPark, beforePark, 'parking a terminal thread must commit nothing to its stored record')
  })
})

test('resume.self-heals-a-corrupt-pointer', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    mkdirSync(layout.state, { recursive: true })
    writeFileSync(pointerFilePath(layout), 'not-json{{{', 'utf8')

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (self-heal)', resumed)
    const structured = resumed.structuredContent as { previous_session: unknown }
    assert.equal(
      structured.previous_session,
      null,
      'a corrupt pointer left behind must be treated as no previous session, not surfaced as one'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (after self-heal)', park)
    const parkStructured = park.structuredContent as { status: string; parked_thread_ids: string[] }
    assert.equal(parkStructured.status, 'parked')
    assert.ok(parkStructured.parked_thread_ids.includes(threadId))
  })
})

test('park.releases-a-corrupt-pointer', async () => {
  await withFixture(async (fx) => {
    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    mkdirSync(layout.state, { recursive: true })
    writeFileSync(pointerFilePath(layout), 'not-json{{{', 'utf8')

    const refused = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-CORRUPT-POINTER this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome when the pointer file does not parse')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, /does not parse/)
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      readFileSync(pointerFilePath(layout), 'utf8'),
      'not-json{{{',
      'a refusal on the corrupt-pointer branch must leave the unreadable pointer file exactly as it found it'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (corrupt pointer)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'stale-pointer-released')
    assert.equal(structured.pointer_released, true)
  })
})

test('park.refuses-when-another-session-took-the-pointer', async () => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-resume-ownership-plugin-data-'))
  try {
    const p1 = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
    try {
      const published1 = await listPublishedTools(p1)
      const { threadId } = await createFixtureThread(p1, published1)
      const firstResume = await callResume(p1, published1, threadId)
      assertOkResult('resume_thread (ownership setup)', firstResume)

      const p2 = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
      try {
        const published2 = await listPublishedTools(p2)
        const secondResume = await callResume(p2, published2, threadId)
        assertOkResult('resume_thread (second session takes the pointer)', secondResume)
      } finally {
        await p2.close()
      }

      const refused = await callPark(p1, published1, {
        outcome: 'MARKER-OTHER-SESSION this text must survive the refusal'
      })
      assert.equal(
        refused.isError,
        true,
        'park_thread must refuse an outcome when another session holds the record of what is being worked'
      )
      const refusedText = firstTextOf(refused)
      assert.equal(refusedText.split('\n')[0], 'field: outcome')
      assert.match(refusedText, /belongs to a different session/)
      assert.match(refusedText, /NOT stored and must be re-sent/)

      const park = await callParkWithoutOutcome(p1, published1, {})
      assertOkResult('park_thread (original session, pointer stolen)', park)
      const structured = park.structuredContent as { status: string; pointer_released: boolean }
      assert.equal(structured.status, 'not-the-worked-thread')
      assert.equal(structured.pointer_released, false)
    } finally {
      await p1.close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test('resume.a-forged-boundary-actor-cannot-drop-entries-from-the-last-session', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const honestFirstBody = 'MARKER-HONEST-FIRST this content belongs to the real working session'
    const forgedBody = 'a forged entry claiming to be the park_thread boundary marker'
    const honestSecondBody = 'MARKER-HONEST-SECOND this content also belongs to the real working session'

    const firstLogged = (await fx.spawned.client.callTool({
      name: 'log_session_event',
      arguments: { thread_id: threadId, actor: 'claude', body: honestFirstBody }
    })) as CallToolResult
    assertOkResult('log_session_event (honest entry one)', firstLogged)

    const forgedLogged = (await fx.spawned.client.callTool({
      name: 'log_session_event',
      arguments: { thread_id: threadId, actor: 'logbook:park_thread', body: forgedBody }
    })) as CallToolResult

    const secondLogged = (await fx.spawned.client.callTool({
      name: 'log_session_event',
      arguments: { thread_id: threadId, actor: 'claude', body: honestSecondBody }
    })) as CallToolResult
    assertOkResult('log_session_event (honest entry two)', secondLogged)

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (forged boundary actor)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing

    assert.ok(
      briefing.includes(honestFirstBody),
      'the Last session section must still carry the first honest entry; a caller-supplied actor value must not be able to forge a session boundary that erases it from the briefing'
    )

    assert.equal(
      forgedLogged.isError,
      true,
      'log_session_event must refuse an actor value reserved for the park_thread boundary marker'
    )
    const forgedText = firstTextOf(forgedLogged)
    assert.equal(
      forgedText.split('\n')[0],
      'field: actor',
      'the refusal for a reserved actor value must name the field "actor"'
    )
  })
})

test('log_session_event.refuses-any-reserved-prefixed-actor-not-only-the-park-boundary-value', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const refused = (await fx.spawned.client.callTool({
      name: 'log_session_event',
      arguments: { thread_id: threadId, actor: 'logbook:close_thread', body: 'a reserved-actor probe body' }
    })) as CallToolResult

    assert.equal(
      refused.isError,
      true,
      'log_session_event must refuse any actor beginning with the reserved prefix, not only the exact park_thread boundary value'
    )
    assert.equal(
      firstTextOf(refused).split('\n')[0],
      'field: actor',
      'the refusal for a reserved-prefixed actor must name the field "actor"'
    )
  })
})

test('resume.briefing-counts-and-addresses-an-unreadable-session-entry', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const logged = (await fx.spawned.client.callTool({
      name: 'log_session_event',
      arguments: { thread_id: threadId, actor: 'claude', body: 'MARKER-READABLE-ENTRY this entry must survive intact' }
    })) as CallToolResult
    assertOkResult('log_session_event (unreadable session entry probe, readable entry)', logged)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    mkdirSync(sessionEntriesDir(layout, threadId), { recursive: true })
    const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
    const unreadableEntryId = rt.ulid()
    writeFileSync(join(sessionEntriesDir(layout, threadId), `${unreadableEntryId}.json`), '{not-json', 'utf8')

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (unreadable session entry probe)', resumed)
    const structured = resumed.structuredContent as { briefing: string }

    assert.match(
      structured.briefing,
      /- 1 session log entry on this thread could not be read; see logbook:\/\/sessions\//,
      'the briefing must count the one session entry that failed to parse'
    )
    assert.match(
      structured.briefing,
      new RegExp(`logbook://sessions/${threadId}`),
      'the briefing must carry the address that resolves to the thread\'s session log'
    )
    assert.ok(
      structured.briefing.includes('MARKER-READABLE-ENTRY this entry must survive intact'),
      'the one readable session entry must still render alongside the count of unreadable ones'
    )
  })
})
