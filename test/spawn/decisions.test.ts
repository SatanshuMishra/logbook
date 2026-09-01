import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fork, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { ALL_TOOLS, type ToolSpec, type ToolContext, type ToolReply } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { recordDecisionTool } from '../../src/server/tools/record_decision.ts'

import type { Runtime } from '../../src/runtime/runtime.ts'
import { declare } from '../../src/schema/declare.ts'
import { ULID_PATTERN } from '../../src/schema/ids.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import type { KeyDecision, Thread } from '../../src/schema/thread.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { git } from '../../src/store/git.ts'
import { writeRecords, type RecordChange } from '../../src/store/write-path.ts'
import { sync } from '../../src/merge/sync.ts'

import { census, type Classified } from '../support/census.ts'
import * as caps from '../../src/schema/caps.ts'
import { rawGit } from '../support/git-fixture.ts'
import type { Teammate } from '../support/clone-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import {
  generateSchemaCases,
  buildValidInstance,
  type ConstraintClass,
  type JsonSchemaNode,
  type Mutation
} from '../support/schema-arbitrary.ts'
import { adaptProbeSpec, type ProbeSpec } from '../support/probe-server.ts'

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`decisions fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const withCwd = (rt: Runtime, cwd: string): Runtime => ({ ...rt, cwd })

type AnyHandler = (rt: Runtime, ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolReply<unknown>>

const DUMMY_CTX = {} as unknown as ToolContext

const callTool = async (
  handler: unknown,
  rt: Runtime,
  input: Record<string, unknown>
): Promise<ToolReply<unknown>> => (handler as AnyHandler)(rt, DUMMY_CTX, input)

const bootstrapCommittedRepo = (prefix: string): string => {
  const repo = mkdtempSync(path.join(tmpdir(), `${prefix}-`))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Decisions Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'decisions-fixture@logbook.test'])
  writeFileSync(path.join(repo, 'README.md'), 'logbook decisions fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}


const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = path.join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const JSON_RPC_FRAMING_PATTERN = /"jsonrpc"\s*:\s*"2\.0"/

type SpawnFixture = {
  spawned: SpawnedServer
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
  repo: string
  pluginData: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const withSpawnFixture = async (fn: (fx: SpawnFixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapCommittedRepo('logbook-decisions-spawn-repo')
  const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-decisions-spawn-plugin-data-'))
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
    await fn({ spawned, published, outputSchemas, repo, pluginData })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const schemaFor = (tools: PublishedTool[], name: string): JsonSchemaNode => {
  const found = tools.find((t) => t.name === name)
  if (found === undefined) throw new Error(`decisions spawn fixture: tool "${name}" was not published`)
  return found.inputSchema
}

const outputSchemaFor = (outputSchemas: Map<string, Record<string, unknown>>, name: string): Record<string, unknown> => {
  const found = outputSchemas.get(name)
  if (found === undefined) throw new Error(`decisions spawn fixture: tool "${name}" published no output schema`)
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

const createFixtureThread = async (spawned: SpawnedServer, published: PublishedTool[]): Promise<string> => {
  const schema = schemaFor(published, 'open_thread')
  const { valid } = generateSchemaCases('open_thread', schema)
  const result = (await spawned.client.callTool({ name: 'open_thread', arguments: valid })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string }
  return structured.thread_id
}

const readStoredThread = (fx: SpawnFixture, threadId: string): Thread => {
  const rt = testRuntime({
    env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
    cwd: fx.repo
  })
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`decisions fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`decisions fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

const openThreadWithCriteria = async (
  fx: SpawnFixture,
  slug: string,
  criteria: string[]
): Promise<{ threadId: string; criteria: { id: string; ordinal: number }[] }> => {
  const opened = (await fx.spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: `${slug} fixture`,
      slug,
      completion_criteria: criteria.map((text) => ({ text, check: 'the spawn fixture check' }))
    }
  })) as CallToolResult
  assertOkResult(`open_thread (${slug})`, opened)
  const structured = opened.structuredContent as {
    thread_id: string
    completion_criteria: { id: string; ordinal: number }[]
  }
  return { threadId: structured.thread_id, criteria: structured.completion_criteria }
}

const markCriterionDone = async (fx: SpawnFixture, threadId: string, criterionId: string): Promise<void> => {
  const marked = (await fx.spawned.client.callTool({
    name: 'update_thread',
    arguments: {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: 'the fixture check was run', result_status: 'verified' }]
    }
  })) as CallToolResult
  assertOkResult('update_thread (mark a criterion done)', marked)
}

const runRejectsInvalid = async (
  fx: SpawnFixture,
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

test('record_decision.spawn.contract', async () => {
  await withSpawnFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'record_decision'))
    const threadId = await createFixtureThread(fx.spawned, fx.published)
    const schema = schemaFor(fx.published, 'record_decision')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'record_decision')
    const { valid } = generateSchemaCases('record_decision', schema, { thread_id: threadId })
    const result = (await fx.spawned.client.callTool({ name: 'record_decision', arguments: valid })) as CallToolResult
    assertOkResult('record_decision', result)
    assertConformsToOutputSchema('record_decision', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('record_decision.rejects-invalid', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)
    await runRejectsInvalid(fx, 'record_decision', ['minItems'], { thread_id: threadId })
  })
})

const DECISION_OUTCOME_SENTINEL = 'SENTINEL-OUTCOME-BODY-e37e0a20 auto-link, because the follow-up is silently optional'

test('decision.outcome-body-is-absent-from-both-briefing-surfaces', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'link decisions into the spine automatically',
        context: 'a decision recorded alone never reaches the briefing',
        options: ['auto-link in record_decision', 'require a follow-up update_thread'],
        outcome: DECISION_OUTCOME_SENTINEL
      }
    })) as CallToolResult
    assertOkResult('record_decision (auto-link)', recorded)
    const recordedStructured = recorded.structuredContent as { linked: boolean; link_skipped_reason: string | null }
    assert.equal(recordedStructured.linked, true, 'a decision on an ordinary thread must be linked by the same call')
    assert.equal(recordedStructured.link_skipped_reason, null)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId }
    })) as CallToolResult
    assertOkResult('resume_thread (briefing)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    const lines = briefing.split('\n')

    const keyDecisionsAt = lines.indexOf('**Key decisions:**')
    const decisionsAt = lines.indexOf('**Decisions:**')
    assert.notEqual(keyDecisionsAt, -1, 'the briefing must carry a Key decisions section')
    assert.notEqual(decisionsAt, -1, 'the briefing must carry a Decisions section')
    const keyDecisionLine = lines[keyDecisionsAt + 1]
    assert.ok(
      keyDecisionLine !== undefined && keyDecisionLine.startsWith('- link decisions into the spine automatically (decision '),
      `the Key decisions section must carry the decision title with no intervening update_thread call, got: ${String(keyDecisionLine)}`
    )
    assert.ok(
      keyDecisionLine !== undefined && /\(decision [0-9A-HJKMNP-TV-Z]{26}\)$/.test(keyDecisionLine),
      `the Key decisions section must carry the decision id beside the title, got: ${String(keyDecisionLine)}`
    )
    assert.equal(
      briefing.includes(DECISION_OUTCOME_SENTINEL),
      false,
      'resume_thread must never inline a decision outcome body into the briefing it returns'
    )

    const resourceRead = await fx.spawned.client.readResource({ uri: `logbook://thread/${threadId}` })
    const [firstContent] = resourceRead.contents
    assert.ok(
      firstContent !== undefined && 'text' in firstContent && typeof firstContent.text === 'string',
      'expected logbook://thread to return text content'
    )
    const resourceText = (firstContent as { text: string }).text
    assert.equal(
      resourceText.includes(DECISION_OUTCOME_SENTINEL),
      false,
      'logbook://thread must never inline a decision outcome body into the rendering it returns'
    )
  })
})

test('decision.omitted-scope-is-stored-empty', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-omission-fixture', [
      'the first criterion',
      'the second criterion',
      'the third criterion'
    ])
    const first = fixture.criteria[0]
    assert.ok(first !== undefined, 'open_thread must mint the completion criteria it was given')
    assert.equal(first.ordinal, 1, 'the first minted criterion must carry ordinal 1')
    await markCriterionDone(fx, fixture.threadId, first.id)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with no scope supplied',
        context: 'the first criterion is already done',
        options: ['store an empty scope', 'invent one from open criteria'],
        outcome: 'store an empty scope; nothing is derived'
      }
    })) as CallToolResult
    assertOkResult('record_decision (omitted scope)', recorded)
    const recordedStructured = recorded.structuredContent as { scope: string | null }
    assert.equal(recordedStructured.scope, null, 'the reply must report an omitted scope as null')

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      '',
      'an omitted scope must be stored as the empty string, never derived from open criteria'
    )
  })
})

test('decision.an-explicit-scope-is-stored-verbatim', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a decision with an explicit scope',
        context: 'the caller knows the area the decision resolved',
        options: ['send an explicit scope', 'leave it out'],
        outcome: 'send an explicit one',
        scope: 'the merge queue fast path'
      }
    })) as CallToolResult
    assertOkResult('record_decision (explicit scope)', recorded)
    const recordedStructured = recorded.structuredContent as { scope: string | null }
    assert.equal(recordedStructured.scope, 'the merge queue fast path', 'the reply must echo the supplied scope')

    const stored = readStoredThread(fx, threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(stored.spine.key_decisions[0]?.scope, 'the merge queue fast path', 'an explicit scope must be stored verbatim')
  })
})

test('decision.omitting-scope-succeeds-even-when-no-criterion-is-open', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-no-open-criterion-fixture', ['the only criterion'])
    const only = fixture.criteria[0]
    assert.ok(only !== undefined, 'open_thread must mint the one criterion it was given')
    await markCriterionDone(fx, fixture.threadId, only.id)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision recorded once every criterion is done',
        context: 'every criterion is done, and that is legitimate',
        options: ['refuse for lack of an open criterion', 'succeed with an empty scope'],
        outcome: 'succeed with an empty scope; a thread-wide decision is legitimate'
      }
    })) as CallToolResult

    assertOkResult('record_decision (no open criterion, scope omitted)', recorded)
    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      '',
      'omitting scope must never be refused for lack of an open criterion'
    )
  })
})

test('decision.criterion_id-is-stored-on-the-key-decision-when-supplied', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'criterion-id-anchor-fixture', ['the anchor criterion'])
    const anchor = fixture.criteria[0]
    assert.ok(anchor !== undefined, 'open_thread must mint the one criterion it was given')

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision anchored to one criterion',
        context: 'this decision ranks against a single criterion',
        options: ['anchor it to the criterion', 'leave it unanchored'],
        outcome: 'anchor it to the criterion',
        criterion_id: anchor.id
      }
    })) as CallToolResult
    assertOkResult('record_decision (criterion_id supplied)', recorded)

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.criterion_id,
      anchor.id,
      'a supplied criterion_id must be stored on the key-decision link'
    )
  })
})

test('decision.criterion_id-is-absent-from-the-key-decision-when-omitted', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a decision anchored to nothing in particular',
        context: 'this decision is not anchored to one criterion',
        options: ['anchor it', 'leave it unanchored'],
        outcome: 'leave it unanchored'
      }
    })) as CallToolResult
    assertOkResult('record_decision (criterion_id omitted)', recorded)

    const stored = readStoredThread(fx, threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.criterion_id,
      undefined,
      'an omitted criterion_id must never be invented onto the key-decision link'
    )
  })
})

test('update_thread.refuses-a-risk-naming-no-criterion-on-the-thread', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'risk-criterion-existence-fixture', ['the only criterion'])
    const danglingCriterionId = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
    assert.notEqual(
      fixture.criteria[0]?.id,
      danglingCriterionId,
      'the fixture must mint a criterion id that differs from the dangling probe id'
    )

    const refused = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: {
        thread_id: fixture.threadId,
        risks_add: [
          {
            text: 'a risk anchored to a criterion absent from this thread',
            scope: 'an area of the thread',
            criterion_id: danglingCriterionId
          }
        ]
      }
    })) as CallToolResult

    assert.equal(refused.isError, true, 'update_thread must refuse a risk naming a criterion absent from the thread')
    const text = firstTextOf(refused)
    assert.equal(text.split('\n')[0], 'field: risks_add')
    assert.match(text, new RegExp(danglingCriterionId))

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.open_risks.length, 0, 'the refused risk must not have been written to the spine')
  })
})

test('decision.records-the-decision-and-reports-the-skipped-link-at-the-byte-cap', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const rt = testRuntime({
      env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
      cwd: fx.repo
    })
    const opened = openStore(rt, fx.repo)
    assert.equal(opened.ok, true, 'the byte-cap fixture must be able to open the store')
    if (!opened.ok) return
    const store = opened.value

    const maxLengthEntry = (): KeyDecision => ({
      id: rt.ulid(),
      decision_id: rt.ulid(),
      title: 't'.repeat(caps.KEY_DECISION_TITLE_MAX),
      scope: 'c'.repeat(caps.KEY_DECISION_SCOPE_MAX)
    })
    const planned = maxLengthEntry()
    const withEntry = (thread: Thread, entry: KeyDecision): Thread => ({
      ...thread,
      spine: { ...thread.spine, key_decisions: [...thread.spine.key_decisions, entry] }
    })
    const bytesOf = (thread: Thread): number => Buffer.byteLength(JSON.stringify(thread), 'utf8')
    const grow = (thread: Thread): Thread => {
      if (bytesOf(withEntry(thread, planned)) > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) return thread
      if (thread.spine.key_decisions.length >= caps.KEY_DECISIONS_MAX_ELEMENTS - 1) return thread
      return grow(withEntry(thread, maxLengthEntry()))
    }

    const saturated = grow(readStoredThread(fx, threadId))
    assert.ok(
      bytesOf(saturated) <= caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      'the saturated fixture must itself still fit inside the byte cap'
    )
    assert.ok(
      bytesOf(withEntry(saturated, planned)) > caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      'the saturated fixture must leave no room for one more maximum-length link'
    )
    const seeded = store.commit([{ kind: 'thread', record: saturated }], 'saturate the thread to the byte cap')
    assert.equal(seeded.ok, true, 'the saturated fixture must commit before the tool is called')

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 't'.repeat(caps.KEY_DECISION_TITLE_MAX),
        context: 'the thread record has no room left for another link',
        options: ['refuse the whole call', 'record the decision and skip the link'],
        outcome: 'record the decision and skip the link',
        scope: 'c'.repeat(caps.KEY_DECISION_SCOPE_MAX)
      }
    })) as CallToolResult

    assertOkResult('record_decision (at the byte cap)', recorded)
    const structured = recorded.structuredContent as {
      decision_id: string
      linked: boolean
      link_skipped_reason: string | null
    }
    assert.equal(structured.linked, false, 'the link must be reported as not written')
    assert.notEqual(structured.link_skipped_reason, null, 'a skipped link must carry a populated reason')
    assert.match(String(structured.link_skipped_reason), /over its cap of/)

    const afterStore = openStore(rt, fx.repo)
    assert.equal(afterStore.ok, true, 'the store must reopen after the tool call')
    if (!afterStore.ok) return
    const decisionSlot = afterStore.value.readDecision(structured.decision_id)
    assert.ok(
      decisionSlot !== null && !decisionSlot.quarantined,
      'the decision itself must be on disk even though the link was skipped'
    )

    const afterThread = readStoredThread(fx, threadId)
    assert.equal(
      afterThread.spine.key_decisions.length,
      saturated.spine.key_decisions.length,
      'the running summary must be unchanged when the link is skipped'
    )
  })
})

test('log_session_event.spawn.contract', async () => {
  await withSpawnFixture(async (fx) => {
    assert.ok(fx.published.some((t) => t.name === 'log_session_event'))
    const threadId = await createFixtureThread(fx.spawned, fx.published)
    const schema = schemaFor(fx.published, 'log_session_event')
    const outputSchema = outputSchemaFor(fx.outputSchemas, 'log_session_event')
    const { valid } = generateSchemaCases('log_session_event', schema, { thread_id: threadId })
    const result = (await fx.spawned.client.callTool({ name: 'log_session_event', arguments: valid })) as CallToolResult
    assertOkResult('log_session_event', result)
    assertConformsToOutputSchema('log_session_event', outputSchema, result.structuredContent)
    assert.doesNotMatch(fx.spawned.stderr(), JSON_RPC_FRAMING_PATTERN)
  })
})

test('log_session_event.rejects-invalid', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)
    await runRejectsInvalid(fx, 'log_session_event', ['minItems'], { thread_id: threadId })
  })
})


test('decision.supersede-retains', async () => {
  const repo = bootstrapCommittedRepo('logbook-supersede-repo')
  const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-supersede-plugin-data-'))
  try {
    const rt = withCwd(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } }), repo)

    const opened = await callTool(openThreadTool.handler, rt, {
      title: 'supersede fixture thread',
      slug: 'supersede-fixture-thread',
      completion_criteria: [{ text: 'a criterion for the supersede fixture', check: 'the supersede fixture check' }]
    })
    assert.equal(opened.ok, true)
    if (!opened.ok) return
    const threadId = (opened.structured as { thread_id: string }).thread_id

    const recordedA = await callTool(recordDecisionTool.handler, rt, {
      thread_id: threadId,
      title: 'decision A: the original choice',
      context: 'the situation before deciding',
      options: ['keep the original approach', 'switch approach'],
      outcome: 'decision A kept the original approach'
    })
    assert.equal(recordedA.ok, true)
    if (!recordedA.ok) return
    const decisionAId = (recordedA.structured as { decision_id: string }).decision_id

    const layoutResult = layoutFor(rt, repo)
    assert.equal(layoutResult.ok, true)
    if (!layoutResult.ok) return
    const decisionAPath = path.join(layoutResult.value.records, 'decisions', `${decisionAId}.json`)
    const decisionARawBefore = readFileSync(decisionAPath, 'utf8')

    const recordedB = await callTool(recordDecisionTool.handler, rt, {
      thread_id: threadId,
      title: 'decision B: the reversal',
      context: 'the situation after deciding to reverse',
      options: ['reverse decision A'],
      outcome: 'decision B reversed decision A',
      supersedes: [decisionAId]
    })
    assert.equal(recordedB.ok, true)
    if (!recordedB.ok) return
    const decisionBId = (recordedB.structured as { decision_id: string }).decision_id
    assert.notEqual(decisionBId, decisionAId)

    assert.equal(existsSync(decisionAPath), true, "decision A's file must still exist after B supersedes it")
    const decisionARawAfter = readFileSync(decisionAPath, 'utf8')
    assert.equal(decisionARawAfter, decisionARawBefore, "decision A's stored bytes must be unchanged by recording B")

    const reopened = openStore(rt, repo)
    assert.equal(reopened.ok, true)
    if (!reopened.ok) return
    const slotA = reopened.value.readDecision(decisionAId)
    assert.ok(slotA !== null && !slotA.quarantined, 'decision A must still be readable through readDecision after B supersedes it')
    if (slotA === null || slotA.quarantined) return
    assert.equal(slotA.record.title, 'decision A: the original choice')
    assert.deepEqual(slotA.record.supersedes, [], "decision A's own supersedes list must remain empty; only B changed")

    const slotB = reopened.value.readDecision(decisionBId)
    assert.ok(slotB !== null && !slotB.quarantined)
    if (slotB === null || slotB.quarantined) return
    assert.deepEqual(slotB.record.supersedes, [decisionAId])
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
})


test('decision.records-project-head', async () => {
  const bootstrapUnbornRepo = (): string => {
    const repo = mkdtempSync(path.join(tmpdir(), 'logbook-project-head-unborn-'))
    runSetupStep(repo, ['init', '--initial-branch=main'])
    runSetupStep(repo, ['config', 'user.name', 'Logbook Project Head Fixture'])
    runSetupStep(repo, ['config', 'user.email', 'project-head@logbook.test'])
    return repo
  }

  const recordOneDecision = async (repo: string): Promise<ToolReply<unknown>> => {
    const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-project-head-plugin-data-'))
    try {
      const rt = withCwd(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } }), repo)
      const opened = await callTool(openThreadTool.handler, rt, {
        title: 'project head fixture thread',
        slug: 'project-head-fixture-thread',
        completion_criteria: [
          { text: 'a criterion for the project head fixture', check: 'the project head fixture check' }
        ]
      })
      assert.equal(opened.ok, true)
      if (!opened.ok) throw new Error('project head fixture: open_thread was refused')
      const threadId = (opened.structured as { thread_id: string }).thread_id
      return await callTool(recordDecisionTool.handler, rt, {
        thread_id: threadId,
        title: 'project head fixture decision',
        context: '',
        options: [],
        outcome: 'project head fixture outcome'
      })
    } finally {
      rmSync(pluginData, { recursive: true, force: true })
    }
  }

  const committedRepo = bootstrapCommittedRepo('logbook-project-head-repo')
  try {
    const reply = await recordOneDecision(committedRepo)
    assert.equal(reply.ok, true)
    if (!reply.ok) return
    const expectedHead = rawGit(committedRepo, ['rev-parse', 'HEAD'])
    assert.equal(expectedHead.status, 0)
    const structured = reply.structured as { commit: string | null }
    assert.equal(structured.commit, expectedHead.stdout.trim())
  } finally {
    rmSync(committedRepo, { recursive: true, force: true })
  }

  const unbornRepo = bootstrapUnbornRepo()
  try {
    const headProbe = rawGit(unbornRepo, ['rev-parse', 'HEAD'])
    assert.notEqual(headProbe.status, 0, 'the unborn-branch fixture must not already carry a HEAD commit')

    const reply = await recordOneDecision(unbornRepo)
    assert.equal(reply.ok, true)
    if (!reply.ok) return
    const structured = reply.structured as { commit: string | null }
    assert.equal(structured.commit, null)
  } finally {
    rmSync(unbornRepo, { recursive: true, force: true })
  }
})


const RECORD_DECISION_MODULE = fileURLToPath(new URL('../../src/server/tools/record_decision.ts', import.meta.url))
const ULID_MODULE_PATH = fileURLToPath(import.meta.resolve('ulid'))

const buildConcurrentRecorderScript = (params: {
  repo: string
  pluginData: string
  threadId: string
  home: string
}): string => `
import { recordDecisionTool } from ${JSON.stringify(RECORD_DECISION_MODULE)}
import { ulid } from ${JSON.stringify(ULID_MODULE_PATH)}

const repo = ${JSON.stringify(params.repo)}
const pluginData = ${JSON.stringify(params.pluginData)}
const threadId = ${JSON.stringify(params.threadId)}
const home = ${JSON.stringify(params.home)}

const rt = {
  now: () => new Date().toISOString(),
  ulid: () => ulid(),
  env: { HOME: home, CLAUDE_PLUGIN_DATA: pluginData },
  cwd: repo,
  log: () => {},
  sessionId: ulid()
}

const waitForGo = () => new Promise((resolve, reject) => {
  process.once('message', (message) => {
    if (message && message.type === 'go') {
      resolve()
    } else {
      reject(new Error('expected a go message, got ' + JSON.stringify(message)))
    }
  })
})

const isContentionRefusal = (refusal) => refusal.retryable === true && refusal.field === 'decision' && 'detail' in refusal

const attemptRecord = () => recordDecisionTool.handler(rt, {}, {
  thread_id: threadId,
  title: 'concurrent census probe decision',
  context: '',
  options: [],
  outcome: 'concurrent census probe outcome'
})

process.send({ type: 'ready' })
await waitForGo()

let reply = await attemptRecord()

let contentionRetries = 0
const maxContentionRetries = 20
while (!reply.ok && isContentionRefusal(reply.refusal) && contentionRetries < maxContentionRetries) {
  contentionRetries += 1
  reply = await attemptRecord()
}

if (!reply.ok) {
  process.stderr.write('refused: ' + JSON.stringify(reply.refusal) + '\\n')
  process.disconnect()
  process.exit(1)
}

process.stdout.write(JSON.stringify({ id: reply.structured.decision_id }))
process.disconnect()
`

type ChildResult = { code: number | null; stdout: string; stderr: string }

type ForkedRecorder = {
  child: ChildProcess
  ready: Promise<void>
  done: Promise<ChildResult>
}

const runForkedRecorder = (scriptPath: string): ForkedRecorder => {
  const child = fork(scriptPath, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  const ready = new Promise<void>((resolve, reject) => {
    child.once('message', (message) => {
      const parsed = message as { type?: string }
      if (parsed.type === 'ready') {
        resolve()
      } else {
        reject(new Error(`expected a ready message from the forked recorder, got ${JSON.stringify(message)}`))
      }
    })
    child.once('error', reject)
  })

  const done = new Promise<ChildResult>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })

  return { child, ready, done }
}

test('concurrent.distinct-ids', async () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'logbook-concurrent-repo-'))
  const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-concurrent-plugin-data-'))
  const scriptDirs: string[] = []
  try {
    runSetupStep(repo, ['init', '--initial-branch=main'])
    runSetupStep(repo, ['config', 'user.name', 'Logbook Concurrency Fixture'])
    runSetupStep(repo, ['config', 'user.email', 'concurrency@logbook.test'])
    writeFileSync(path.join(repo, 'README.md'), 'logbook concurrency fixture repository\n')
    runSetupStep(repo, ['add', 'README.md'])
    runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])

    const parentRt = withCwd(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } }), repo)
    const opened = await callTool(openThreadTool.handler, parentRt, {
      title: 'concurrency fixture thread',
      slug: 'concurrency-fixture-thread',
      completion_criteria: [
        { text: 'a criterion for the concurrency fixture', check: 'the concurrency fixture check' }
      ]
    })
    assert.equal(opened.ok, true)
    if (!opened.ok) return
    const threadId = (opened.structured as { thread_id: string }).thread_id

    const CHILD_COUNT = 8
    const scriptPaths: string[] = []

    for (let i = 0; i < CHILD_COUNT; i += 1) {
      const scriptDir = mkdtempSync(path.join(tmpdir(), `logbook-concurrent-child-${i}-`))
      scriptDirs.push(scriptDir)
      const scriptPath = path.join(scriptDir, 'record-decision.mjs')
      writeFileSync(
        scriptPath,
        buildConcurrentRecorderScript({ repo, pluginData, threadId, home: process.env.HOME ?? '' }),
        'utf8'
      )
      scriptPaths.push(scriptPath)
    }

    const recorders = scriptPaths.map((scriptPath) => runForkedRecorder(scriptPath))

    await Promise.all(recorders.map((recorder) => recorder.ready))
    for (const recorder of recorders) {
      recorder.child.send({ type: 'go' })
    }

    const results = await Promise.all(recorders.map((recorder) => recorder.done))

    for (const result of results) {
      assert.equal(result.code, 0, `a concurrent record_decision child exited non-zero: ${result.stderr}`)
    }

    const ids = results.map((result) => (JSON.parse(result.stdout) as { id: string }).id)
    assert.equal(ids.length, CHILD_COUNT)
    for (const id of ids) {
      assert.match(id, ULID_PATTERN)
    }
    assert.equal(new Set(ids).size, CHILD_COUNT)

    const finalRt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })
    const finalStore = openStore(finalRt, repo)
    assert.equal(finalStore.ok, true)
    if (!finalStore.ok) return
    for (const id of ids) {
      const slot = finalStore.value.readDecision(id)
      assert.ok(slot !== null && !slot.quarantined, `decision ${id} could not be read back from the store`)
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    for (const scriptDir of scriptDirs) {
      rmSync(scriptDir, { recursive: true, force: true })
    }
  }
})


test('write.no-orphan-record', () => {
  const repo = bootstrapCommittedRepo('logbook-orphan-repo')
  const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-orphan-plugin-data-'))
  try {
    const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })
    const layoutResult = layoutFor(rt, repo)
    assert.equal(layoutResult.ok, true)
    if (!layoutResult.ok) return
    const layout = layoutResult.value

    const makeDecision = (): Extract<RecordChange, { kind: 'decision' }> => ({
      kind: 'decision',
      record: {
        id: rt.ulid(),
        thread_id: rt.ulid(),
        title: 'orphan candidate decision',
        context: '',
        options: [],
        outcome: 'orphan candidate outcome',
        commit: null,
        supersedes: [],
        created_at: rt.now()
      }
    })

    const failingGit: typeof git = (callRt, callRepo, args, opts) => {
      if (args[0] === 'commit-tree') {
        return { ok: false, code: 1, stderr: 'injected commit-tree failure for the decisions orphan check' }
      }
      return git(callRt, callRepo, args, opts)
    }

    const failedWrite = writeRecords(rt, layout, [makeDecision()], 'should fail: decision write', { git: failingGit })
    assert.equal(failedWrite.ok, false)
    if (failedWrite.ok) return
    assert.equal(failedWrite.reason, 'io')

    const decisionsDir = path.join(layout.records, 'decisions')
    const remainingAfterFailure = existsSync(decisionsDir) ? readdirSync(decisionsDir) : []
    assert.deepEqual(remainingAfterFailure, [])

    const nextDecision = makeDecision()
    const succeededWrite = writeRecords(rt, layout, [nextDecision], 'record a real decision after the injected failure')
    assert.equal(succeededWrite.ok, true)

    const opened = openStore(rt, repo)
    assert.equal(opened.ok, true)
    if (!opened.ok) return
    const slot = opened.value.readDecision(nextDecision.record.id)
    assert.ok(slot !== null && !slot.quarantined)
    if (slot === null || slot.quarantined) return
    assert.equal(slot.record.title, nextDecision.record.title)
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
})


type Verdict = Classified<unknown>['verdict'] | 'unclassifiable'

type CensusVariant = { rt: Runtime; input: Record<string, unknown> }

type CensusDriver = {
  name: string
  decisionsDir: string
  handler: AnyHandler
  buildVariants: () => Promise<CensusVariant[]>
}

type CensusWorld = {
  anaRt: Runtime
  benRt: Runtime
  anaDecisionsDir: string
  benDecisionsDir: string
  t0Id: string
  decisionId: string
  t1Id: string
}

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex')

const snapshotDecisions = (dir: string): Map<string, string> => {
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
  const snapshot = new Map<string, string>()
  for (const name of names) {
    snapshot.set(name, sha256(readFileSync(path.join(dir, name), 'utf8')))
  }
  return snapshot
}

const preexistingUnchanged = (before: Map<string, string>, after: Map<string, string>): boolean => {
  for (const [name, hash] of before) {
    const nowHash = after.get(name)
    if (nowHash === undefined || nowHash !== hash) return false
  }
  return true
}

const classifyDriver = async (driver: CensusDriver): Promise<Verdict> => {
  let variants: CensusVariant[]
  try {
    variants = await driver.buildVariants()
  } catch {
    return 'unclassifiable'
  }
  if (variants.length === 0) return 'unclassifiable'

  const before = snapshotDecisions(driver.decisionsDir)
  let acceptedCount = 0
  for (const variant of variants) {
    const reply = await driver.handler(variant.rt, DUMMY_CTX, variant.input)
    if (reply.ok) acceptedCount += 1
  }
  const after = snapshotDecisions(driver.decisionsDir)

  if (acceptedCount === 0) return 'unclassifiable'
  return preexistingUnchanged(before, after) ? 'allowed' : 'forbidden'
}

const mintThread = async (rt: Runtime, criteria: string[]): Promise<{ threadId: string; criterionIds: string[] }> => {
  const reply = await callTool(openThreadTool.handler, rt, {
    title: 'census fixture thread',
    slug: `census-fixture-thread-${randomUUID()}`,
    completion_criteria: criteria.map((text) => ({ text, check: 'the census fixture check' }))
  })
  if (!reply.ok) {
    throw new Error(`census fixture: open_thread refused while minting a fixture thread: ${JSON.stringify(reply.refusal)}`)
  }
  const structured = reply.structured as { thread_id: string; completion_criteria: { id: string }[] }
  return { threadId: structured.thread_id, criterionIds: structured.completion_criteria.map((c) => c.id) }
}

const buildDriver = (tool: ToolSpec<never, never>, world: CensusWorld): CensusDriver => {
  const handler = tool.handler as unknown as AnyHandler

  if (tool.name === 'open_thread') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => [
        {
          rt: world.anaRt,
          input: {
            title: 'census probe: open_thread accepted call',
            slug: `census-open-thread-probe-${randomUUID()}`,
            completion_criteria: [
              { text: 'a criterion minted purely for the open_thread census probe', check: 'the census probe check' }
            ]
          }
        }
      ]
    }
  }

  if (tool.name === 'update_thread') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => {
        const fixture = await mintThread(world.anaRt, ['a criterion for the update_thread census probe'])
        return [
          { rt: world.anaRt, input: { thread_id: fixture.threadId } },
          {
            rt: world.anaRt,
            input: {
              thread_id: fixture.threadId,
              key_decisions_add: [
                { decision_id: world.decisionId, title: 'seed decision linked by the census probe', scope: 'census probe' }
              ]
            }
          }
        ]
      }
    }
  }

  if (tool.name === 'close_thread') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => {
        const fixture = await mintThread(world.anaRt, ['a criterion for the close_thread census probe'])
        return [
          {
            rt: world.anaRt,
            input: { thread_id: fixture.threadId, outcome: 'abandoned', detail: 'closing the close_thread census probe thread' }
          }
        ]
      }
    }
  }

  if (tool.name === 'amend_criteria') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => {
        const fixture = await mintThread(world.anaRt, ['a criterion for the amend_criteria census probe'])
        return [
          {
            rt: world.anaRt,
            input: {
              thread_id: fixture.threadId,
              operation: 'insert',
              decision_id: world.decisionId,
              text: 'a criterion inserted by the amend_criteria census probe',
              check: 'the amend_criteria census probe check',
              kind: 'planned'
            }
          }
        ]
      }
    }
  }

  if (tool.name === 'bind_branch') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => [
        { rt: world.anaRt, input: { thread_id: world.t0Id, branch: `census-probe-branch-${randomUUID()}` } }
      ]
    }
  }

  if (tool.name === 'resume_thread') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => [{ rt: world.anaRt, input: { thread_id: world.t0Id } }]
    }
  }

  if (tool.name === 'park_thread') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => {
        const resumed = await resumeThreadTool.handler(world.anaRt, DUMMY_CTX, { thread_id: world.t0Id })
        if (!resumed.ok) {
          throw new Error(`census fixture: resume_thread refused while arranging the park_thread census probe: ${JSON.stringify(resumed.refusal)}`)
        }
        return [{ rt: world.anaRt, input: { outcome: 'a session entry written to close out the park_thread census probe' } }]
      }
    }
  }

  if (tool.name === 'record_decision') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => [
        {
          rt: world.anaRt,
          input: {
            thread_id: world.t0Id,
            title: 'census probe decision without supersedes',
            context: '',
            options: [],
            outcome: 'census probe outcome without supersedes'
          }
        },
        {
          rt: world.anaRt,
          input: {
            thread_id: world.t0Id,
            title: 'census probe decision superseding the seed decision',
            context: '',
            options: [],
            outcome: 'census probe outcome superseding the seed decision',
            supersedes: [world.decisionId]
          }
        }
      ]
    }
  }

  if (tool.name === 'log_session_event') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => [
        {
          rt: world.anaRt,
          input: { thread_id: world.t0Id, actor: 'census-probe', body: 'a session entry written by the immutability census' }
        }
      ]
    }
  }

  if (tool.name === 'sync_ledger') {
    return {
      name: tool.name,
      decisionsDir: world.anaDecisionsDir,
      handler,
      buildVariants: async () => [{ rt: world.anaRt, input: {} }]
    }
  }

  if (tool.name === 'resolve_conflict') {
    return {
      name: tool.name,
      decisionsDir: world.benDecisionsDir,
      handler,
      buildVariants: async () => [
        {
          rt: world.benRt,
          input: { resolutions: [{ record: `thread:${world.t1Id}`, field: 'spine.next_step', winner: 'local' }] }
        }
      ]
    }
  }

  return {
    name: tool.name,
    decisionsDir: world.anaDecisionsDir,
    handler,
    buildVariants: async () => {
      const schema = declare(tool.name, tool.input).jsonSchema
      return [{ rt: world.anaRt, input: buildValidInstance(tool.name, schema, {}) }]
    }
  }
}

const buildForbiddenControlDriver = (world: CensusWorld): CensusDriver => {
  const probe: ProbeSpec = {
    name: 'probe_overwrites_a_decision_file',
    description:
      'Directly overwrites the content of an existing decision file on disk to prove the immutability census flags a real amendment as forbidden. It never enters the production tool registry and exists only for this one control.',
    input: z.strictObject({
      decision_id: z.string().regex(ULID_PATTERN).describe('the decision file this probe overwrites'),
      replacement_outcome: z.string().min(1).max(200).describe('the outcome text this probe overwrites the decision file with')
    }),
    output: z.object({ overwritten: z.boolean().describe('always true when the overwrite completed') }),
    handler: async (input) => {
      const { decision_id: decisionId, replacement_outcome: replacementOutcome } = input as {
        decision_id: string
        replacement_outcome: string
      }
      const target = path.join(world.anaDecisionsDir, `${decisionId}.json`)
      const raw = readFileSync(target, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      writeFileSync(target, JSON.stringify({ ...parsed, outcome: replacementOutcome }), 'utf8')
      return { ok: true, text: 'overwrote the decision file', structured: { overwritten: true } }
    }
  }
  const adapted = adaptProbeSpec(probe)
  return {
    name: adapted.name,
    decisionsDir: world.anaDecisionsDir,
    handler: adapted.handler as unknown as AnyHandler,
    buildVariants: async () => [
      {
        rt: world.anaRt,
        input: { decision_id: world.decisionId, replacement_outcome: 'overwritten by the forbidden control probe' }
      }
    ]
  }
}

const buildUnclassifiableControlDriver = (world: CensusWorld): CensusDriver => {
  const probe: ProbeSpec = {
    name: 'probe_root_is_not_an_object',
    description:
      'Publishes a non-object root input schema on purpose to prove the immutability census halts as unclassifiable when its generator cannot produce an input for a schema shape. It never enters the production tool registry and exists only for this one control.',
    input: z.array(z.string()),
    output: z.object({ ok: z.boolean().describe('always true; this probe is never actually called') }),
    handler: async () => ({ ok: true, text: 'unreachable', structured: { ok: true } })
  }
  const adapted = adaptProbeSpec(probe)
  return {
    name: adapted.name,
    decisionsDir: world.anaDecisionsDir,
    handler: adapted.handler as unknown as AnyHandler,
    buildVariants: async () => {
      const schema = declare(adapted.name, adapted.input).jsonSchema
      return [{ rt: world.anaRt, input: buildValidInstance(adapted.name, schema, {}) }]
    }
  }
}

const makeCensusThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: `thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'original next step',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const encodeMonotonicSuffix = (seq: number): string => {
  let value = seq
  const chars: string[] = []
  for (let i = 0; i < 16; i += 1) {
    chars.unshift(CROCKFORD_ALPHABET[value % 32] as string)
    value = Math.floor(value / 32)
  }
  return chars.join('')
}

const withDistinctUlidFactory = (rt: Runtime, timePrefix: string): Runtime => {
  let sequence = 0
  return {
    ...rt,
    ulid: () => {
      const suffix = encodeMonotonicSuffix(sequence)
      sequence += 1
      return `${timePrefix}${suffix}`
    }
  }
}

const provisionCensusTeammate = (
  remote: string,
  identity: { name: string; email: string; ulidPrefix: string }
): { teammate: Teammate; cleanupDirs: string[] } => {
  const repo = mkdtempSync(path.join(tmpdir(), `logbook-census-clone-${identity.name}-`))
  runSetupStep(repo, ['clone', remote, '.'])
  runSetupStep(repo, ['config', 'user.name', identity.name])
  runSetupStep(repo, ['config', 'user.email', identity.email])

  const pluginData = mkdtempSync(path.join(tmpdir(), `logbook-census-plugin-data-${identity.name}-`))
  const baseRt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })
  const rt = withDistinctUlidFactory(baseRt, identity.ulidPrefix)

  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`census fixture could not open ${identity.name}'s store: ${opened.message}`)

  const goOffline = (): void => {
    runSetupStep(repo, ['remote', 'set-url', 'origin', path.join(tmpdir(), `logbook-census-unreachable-${randomUUID()}`)])
  }
  const goOnline = (): void => {
    runSetupStep(repo, ['remote', 'set-url', 'origin', remote])
  }

  return {
    teammate: { name: identity.name, repo, store: opened.value as Store, rt, goOffline, goOnline },
    cleanupDirs: [repo, pluginData]
  }
}

const withCensusTeammates = async (fn: (ana: Teammate, ben: Teammate) => Promise<void>): Promise<void> => {
  const remote = mkdtempSync(path.join(tmpdir(), 'logbook-census-remote-'))
  const cleanupDirs: string[] = []
  try {
    runSetupStep(remote, ['init', '--bare', '--initial-branch=main'])
    const anaProvisioned = provisionCensusTeammate(remote, {
      name: 'census-ana',
      email: 'census-ana@logbook.test',
      ulidPrefix: '01CENSAAAA'
    })
    cleanupDirs.push(...anaProvisioned.cleanupDirs)
    const benProvisioned = provisionCensusTeammate(remote, {
      name: 'census-ben',
      email: 'census-ben@logbook.test',
      ulidPrefix: '01CENSBBBB'
    })
    cleanupDirs.push(...benProvisioned.cleanupDirs)
    await fn(anaProvisioned.teammate, benProvisioned.teammate)
  } finally {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    rmSync(remote, { recursive: true, force: true })
  }
}

test('decision.is-immutable', async () => {
  await withCensusTeammates(async (ana, ben) => {
    const anaLayoutResult = layoutFor(ana.rt, ana.repo)
    assert.equal(anaLayoutResult.ok, true)
    if (!anaLayoutResult.ok) return
    const anaLayout = anaLayoutResult.value

    const benLayoutResult = layoutFor(ben.rt, ben.repo)
    assert.equal(benLayoutResult.ok, true)
    if (!benLayoutResult.ok) return
    const benLayout = benLayoutResult.value

    const anaToolRt = withCwd(ana.rt, ana.repo)
    const benToolRt = withCwd(ben.rt, ben.repo)

    const seedThread = await callTool(openThreadTool.handler, anaToolRt, {
      title: 'census seed thread',
      slug: 'census-seed-thread',
      completion_criteria: [
        { text: 'first seed criterion', check: 'the first seed check' },
        { text: 'second seed criterion', check: 'the second seed check' },
        { text: 'third seed criterion', check: 'the third seed check' }
      ]
    })
    assert.equal(seedThread.ok, true)
    if (!seedThread.ok) return
    const t0Id = (seedThread.structured as { thread_id: string }).thread_id

    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const seedDecision = await callTool(recordDecisionTool.handler, anaToolRt, {
      thread_id: t0Id,
      title: 'census seed decision',
      context: '',
      options: [],
      outcome: 'census seed outcome'
    })
    assert.equal(seedDecision.ok, true)
    if (!seedDecision.ok) return
    const decisionId = (seedDecision.structured as { decision_id: string }).decision_id

    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const conflictThread = makeCensusThread(ana.rt, 'census-conflict-thread')
    assert.equal(ana.store.commit([conflictThread], 'ana: create census conflict thread').ok, true)
    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)
    assert.equal(sync(ben.rt, ben.store, benLayout).ok, true)

    const benConflictSlot = ben.store.readThread(conflictThread.record.id)
    assert.ok(benConflictSlot !== null && !benConflictSlot.quarantined)
    if (benConflictSlot === null || benConflictSlot.quarantined) return
    const benEdit: RecordChange = {
      kind: 'thread',
      record: {
        ...benConflictSlot.record,
        spine: { ...benConflictSlot.record.spine, next_step: 'ben changed the census conflict next step' },
        updated_at: ben.rt.now()
      }
    }
    assert.equal(ben.store.commit([benEdit], 'ben: change census conflict next step').ok, true)

    const anaConflictSlot = ana.store.readThread(conflictThread.record.id)
    assert.ok(anaConflictSlot !== null && !anaConflictSlot.quarantined)
    if (anaConflictSlot === null || anaConflictSlot.quarantined) return
    const anaEdit: RecordChange = {
      kind: 'thread',
      record: {
        ...anaConflictSlot.record,
        spine: { ...anaConflictSlot.record.spine, next_step: 'ana changed the census conflict next step' },
        updated_at: ana.rt.now()
      }
    }
    assert.equal(ana.store.commit([anaEdit], 'ana: change census conflict next step').ok, true)

    assert.equal(sync(ana.rt, ana.store, anaLayout).ok, true)

    const benConflictSync = sync(ben.rt, ben.store, benLayout)
    assert.equal(benConflictSync.ok, false)
    if (benConflictSync.ok) return
    assert.equal(benConflictSync.reason, 'conflict')
    const nextStepConflict = benConflictSync.conflicts.find((c) => c.field === 'spine.next_step')
    assert.ok(nextStepConflict !== undefined)

    const world: CensusWorld = {
      anaRt: anaToolRt,
      benRt: benToolRt,
      anaDecisionsDir: path.join(anaLayout.records, 'decisions'),
      benDecisionsDir: path.join(benLayout.records, 'decisions'),
      t0Id,
      decisionId,
      t1Id: conflictThread.record.id
    }

    const drivers = ALL_TOOLS.map((tool) => buildDriver(tool, world))
    assert.ok(drivers.length > 0, 'decision.is-immutable: ALL_TOOLS published no tools; a census over an empty population proves nothing')

    const verdicts = new Map<string, Verdict>()
    for (const driver of drivers) {
      verdicts.set(driver.name, await classifyDriver(driver))
    }
    const classify = (driver: CensusDriver): Verdict => {
      const verdict = verdicts.get(driver.name)
      if (verdict === undefined) throw new Error(`decision.is-immutable: no verdict computed for "${driver.name}"`)
      return verdict
    }
    assert.doesNotThrow(() => census(drivers, classify))

    const forbiddenDriver = buildForbiddenControlDriver(world)
    const forbiddenVerdict = await classifyDriver(forbiddenDriver)
    assert.equal(forbiddenVerdict, 'forbidden', 'the forbidden control must be classified forbidden by actually overwriting a decision file')
    assert.throws(() => census([forbiddenDriver], () => forbiddenVerdict))

    const unclassifiableDriver = buildUnclassifiableControlDriver(world)
    const unclassifiableVerdict = await classifyDriver(unclassifiableDriver)
    assert.equal(unclassifiableVerdict, 'unclassifiable', 'the unclassifiable control must halt because its schema root is not an object')
    assert.throws(() => census([unclassifiableDriver], () => unclassifiableVerdict))
  })
})
