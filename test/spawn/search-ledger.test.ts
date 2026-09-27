import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { generateSchemaCases, type ConstraintClass, type JsonSchemaNode } from '../support/schema-arbitrary.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = path.join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

const TOOL = 'search_ledger'
const MISS_PROVES_NOTHING = 'finding nothing proves nothing'

const EXPECTED_INPUT_PROPERTIES: Readonly<Record<string, Record<string, unknown>>> = {
  text: {
    type: 'string',
    minLength: 1,
    description:
      'words to look for, matched case-insensitively as exact characters in the record text, where any run of spaces or line breaks counts as one space; omit to list every record the other filters allow'
  },
  kind: {
    type: 'string',
    enum: ['decision', 'risk', 'criterion', 'entry', 'artifact', 'out-of-scope'],
    description: 'only records of this kind; entry means a session log entry; omit for every kind'
  },
  thread: {
    type: 'string',
    description: 'only records on this thread, given by id or slug; omit to search every thread, closed ones included'
  },
  status: {
    type: 'string',
    enum: ['live', 'all'],
    description:
      'live, the default, leaves out superseded decisions, retired risks and artifacts, and struck criteria; all includes them'
  }
}

const EXPECTED_OUTPUT_TYPES: Readonly<Record<string, string>> = {
  results: 'string',
  matched: 'number',
  searched: 'number',
  threads: 'number'
}

const RESULTS_DESCRIPTION = 'one line per matching record: kind, id, thread slug and status, and its title or first line'

type Fixture = {
  spawned: SpawnedServer
  published: PublishedTool[]
  listed: Awaited<ReturnType<SpawnedServer['client']['listTools']>>
}

type SearchReply = { results: string; matched: number; searched: number; threads: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`search-ledger fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapCommittedRepo = (): string => {
  const repo = mkdtempSync(path.join(tmpdir(), 'logbook-search-ledger-spawn-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Search Ledger Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'search-ledger-fixture@logbook.test'])
  writeFileSync(path.join(repo, 'README.md'), 'logbook search-ledger fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withSpawnFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapCommittedRepo()
  const pluginDataHome = mkdtempSync(path.join(tmpdir(), 'logbook-search-ledger-spawn-plugin-data-'))
  const pluginData = path.join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const listed = await spawned.client.listTools()
    const published = await listPublishedTools(spawned)
    await fn({ spawned, published, listed })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const schemaFor = (published: PublishedTool[], name: string): JsonSchemaNode => {
  const found = published.find((tool) => tool.name === name)
  if (found === undefined) throw new Error(`search-ledger spawn fixture: tool "${name}" was not published`)
  return found.inputSchema
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const callOk = async (fx: Fixture, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const result = (await fx.spawned.client.callTool({ name, arguments: args })) as CallToolResult
  assert.notEqual(result.isError, true, `${name} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
  assert.ok(isRecord(result.structuredContent), `${name} returned no structured content`)
  return result.structuredContent
}

const search = async (fx: Fixture, args: Record<string, unknown>): Promise<SearchReply> => {
  const result = (await fx.spawned.client.callTool({ name: TOOL, arguments: args })) as CallToolResult
  assert.notEqual(result.isError, true, `${TOOL} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
  assert.equal(firstTextOf(result), '', `${TOOL} sends its list once, in results, so the reply text must be empty`)
  const structured = result.structuredContent
  assert.ok(isRecord(structured), `${TOOL} returned no structured content`)
  assert.equal(typeof structured.results, 'string')
  assert.equal(typeof structured.matched, 'number')
  assert.equal(typeof structured.searched, 'number')
  assert.equal(typeof structured.threads, 'number')
  return structured as SearchReply
}

const lineNaming = (results: string, id: string): string => {
  const line = results.split('\n').find((candidate) => candidate.includes(id))
  assert.ok(line !== undefined, `expected the search results to list record ${id}, got:\n${results}`)
  return line
}

const openThread = async (
  fx: Fixture,
  slug: string,
  title: string
): Promise<{ threadId: string; criterionId: string }> => {
  const structured = await callOk(fx, 'open_thread', {
    title,
    slug,
    active_goal: `carry the ${slug} work`,
    next_step: `pick up the ${slug} work`,
    completion_criteria: [{ text: `the ${slug} work is finished`, check: `read the ${slug} result`, settledness: 'proposed' }]
  })
  const criteria = structured.completion_criteria as { id: string }[]
  const [criterion] = criteria
  assert.ok(criterion !== undefined, `expected open_thread to mint a criterion for ${slug}`)
  return { threadId: structured.thread_id as string, criterionId: criterion.id }
}

const recordDecision = async (
  fx: Fixture,
  threadId: string,
  title: string,
  outcome: string,
  extra: Record<string, unknown> = {}
): Promise<string> => {
  const structured = await callOk(fx, 'record_decision', {
    thread_id: threadId,
    title,
    context: 'the upstream gateway answered with 502 under load',
    options: ['raise the limit', 'keep the limit'],
    outcome,
    ...extra
  })
  return structured.decision_id as string
}

const closeAsDone = async (fx: Fixture, threadId: string, criterionId: string): Promise<void> => {
  await callOk(fx, 'update_thread', {
    thread_id: threadId,
    criteria_done: [{ criterion_id: criterionId, result: 'the incident review was read', result_status: 'verified' }]
  })
  await callOk(fx, 'close_thread', { thread_id: threadId, outcome: 'done', detail: 'the incident review is complete' })
}

const CLOSED_SLUG = 'gateway-502-incident'
const CLOSED_TITLE = 'Gateway 502 incident'

test('search_ledger.spawn.contract', async () => {
  await withSpawnFixture(async (fx) => {
    const tool = fx.listed.tools.find((candidate) => candidate.name === TOOL)
    assert.ok(tool !== undefined, `the live server does not list ${TOOL}`)
    assert.equal(tool.title, 'Search ledger')
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    })

    const input = tool.inputSchema as Record<string, unknown>
    assert.equal(input.type, 'object')
    assert.equal(input.additionalProperties, false, 'the input is a strict object, so an unknown key is refused')
    assert.deepEqual(input.required ?? [], [], 'every search_ledger input field is optional')
    assert.ok(isRecord(input.properties), 'the published input schema carries no properties')
    assert.deepEqual(Object.keys(input.properties).sort(), Object.keys(EXPECTED_INPUT_PROPERTIES).sort())
    for (const [key, expected] of Object.entries(EXPECTED_INPUT_PROPERTIES)) {
      const node: unknown = input.properties[key]
      assert.ok(isRecord(node), `input property ${key} is not an object schema`)
      for (const [keyword, value] of Object.entries(expected)) {
        assert.deepEqual(node[keyword], value, `input property ${key} publishes ${keyword} ${JSON.stringify(node[keyword])}`)
      }
    }

    const output = tool.outputSchema as Record<string, unknown> | undefined
    assert.ok(isRecord(output) && isRecord(output.properties), `${TOOL} publishes no output schema`)
    assert.deepEqual(Object.keys(output.properties).sort(), Object.keys(EXPECTED_OUTPUT_TYPES).sort())
    assert.deepEqual([...((output.required as string[] | undefined) ?? [])].sort(), Object.keys(EXPECTED_OUTPUT_TYPES).sort())
    for (const [key, type] of Object.entries(EXPECTED_OUTPUT_TYPES)) {
      const node: unknown = output.properties[key]
      assert.ok(isRecord(node), `output property ${key} is not an object schema`)
      assert.equal(node.type, type, `output property ${key} publishes type ${String(node.type)}`)
    }
    assert.equal((output.properties.results as Record<string, unknown>).description, RESULTS_DESCRIPTION)

    const reply = await search(fx, {})
    for (const [key, type] of Object.entries(EXPECTED_OUTPUT_TYPES)) {
      assert.equal(typeof (reply as unknown as Record<string, unknown>)[key], type, `structured ${key} does not conform to its published type`)
    }
    assert.equal(reply.matched, 0)
    assert.ok(!reply.results.includes(MISS_PROVES_NOTHING), 'a call without text must not claim a text search missed')
  })
})

const EXPECTED_MISSING_CLASSES: readonly ConstraintClass[] = ['required', 'maxLength', 'pattern', 'minItems']

const UNKNOWN_KEY = 'logbook-unexpected-field'

const assertRefusalNamesField = (label: string, field: string, result: CallToolResult): void => {
  assert.equal(result.isError, true, `${label} should have been refused as a tool error`)
  const text = firstTextOf(result)
  assert.equal(text.split('\n')[0], `field: ${field}`, `${label}: expected the refusal to name field "${field}", got:\n${text}`)
  assert.match(text, /^accepted: /m, `${label}: the refusal is missing the accepted part`)
  assert.match(text, /^example: /m, `${label}: the refusal is missing the example part`)
  assert.match(text, /^retryable: (true|false)/m, `${label}: the refusal is missing the retryable part`)
}

test('search_ledger.rejects-invalid', async () => {
  await withSpawnFixture(async (fx) => {
    const schema = schemaFor(fx.published, TOOL)
    const { valid, mutations, missing } = generateSchemaCases(TOOL, schema)
    assert.deepEqual(
      new Set(missing.map((entry) => entry.class)),
      new Set(EXPECTED_MISSING_CLASSES),
      `expected ${TOOL}'s published schema to carry no mutation for exactly [${EXPECTED_MISSING_CLASSES.join(', ')}], but it carried none for [${missing.map((entry) => entry.class).join(', ')}]`
    )
    assert.ok(
      mutations.some((mutation) => mutation.class === 'unknownKey' && mutation.field === UNKNOWN_KEY),
      'expected the generated mutations to include an unknown key'
    )

    const enumAndLengthMutations = [
      { label: 'a wrong kind', field: 'kind', input: { ...valid, kind: 'not-a-record-kind' } },
      { label: 'a wrong status', field: 'status', input: { ...valid, status: 'not-a-status' } },
      { label: 'an empty text', field: 'text', input: { ...valid, text: '' } }
    ]
    const cases = [
      ...mutations.map((mutation) => ({
        label: `mutation "${mutation.field}" (${mutation.class})`,
        field: mutation.field,
        input: mutation.input
      })),
      ...enumAndLengthMutations
    ]
    for (const entry of cases) {
      const result = (await fx.spawned.client.callTool({ name: TOOL, arguments: entry.input })) as CallToolResult
      assertRefusalNamesField(`${TOOL} ${entry.label}`, entry.field, result)
    }
  })
})

test('search_ledger.lists-records-on-closed-threads', async () => {
  await withSpawnFixture(async (fx) => {
    const closed = await openThread(fx, CLOSED_SLUG, CLOSED_TITLE)
    const decisionId = await recordDecision(
      fx,
      closed.threadId,
      'Keep the upstream connection pool at forty',
      'the pool stays at forty connections'
    )
    await closeAsDone(fx, closed.threadId, closed.criterionId)

    const reply = await search(fx, {})
    const line = lineNaming(reply.results, decisionId)
    assert.ok(line.includes(CLOSED_SLUG), `the decision line does not name the thread slug: ${line}`)
    assert.match(line, /\bdone\b/, `the decision line does not carry the closed thread's status done: ${line}`)
    assert.ok(line.includes('decision'), `the decision line does not name its kind: ${line}`)
    assert.ok(reply.matched >= 1)
    assert.ok(reply.threads >= 1)
  })
})

test('search_ledger.text-search-says-a-miss-proves-nothing', async () => {
  await withSpawnFixture(async (fx) => {
    const closed = await openThread(fx, CLOSED_SLUG, CLOSED_TITLE)
    const decisionId = await recordDecision(
      fx,
      closed.threadId,
      'Keep the gateway Timeout at or below 3000 ms',
      'HTTP_TIMEOUT_MS in src/config.ts stays at 3000'
    )
    await closeAsDone(fx, closed.threadId, closed.criterionId)

    const open = await openThread(fx, 'retry-jitter', 'Retry jitter')
    const entry = await callOk(fx, 'log_session_event', {
      thread_id: open.threadId,
      actor: 'claude',
      body: 'Measured the gateway\ntimeout under the retry storm; it held at 3000 ms.'
    })
    const entryId = entry.session_entry_id as string

    const miss = await search(fx, { text: 'zebra quartz marmalade' })
    assert.equal(miss.matched, 0)
    assert.ok(miss.results.includes(MISS_PROVES_NOTHING), `a missed text search must say ${MISS_PROVES_NOTHING}:\n${miss.results}`)

    const hit = await search(fx, { text: 'gateway timeout' })
    assert.equal(hit.matched, 2, `expected exactly the decision and the entry to match:\n${hit.results}`)
    assert.ok(lineNaming(hit.results, decisionId).includes(CLOSED_SLUG))
    assert.ok(lineNaming(hit.results, entryId).includes('retry-jitter'))
    assert.ok(hit.results.includes(MISS_PROVES_NOTHING), 'every text search reply says that finding nothing proves nothing')
  })
})

test('search_ledger.live-status-leaves-out-superseded-decisions', async () => {
  await withSpawnFixture(async (fx) => {
    const thread = await openThread(fx, 'retry-policy', 'Retry policy')
    const firstId = await recordDecision(fx, thread.threadId, 'Retry three times', 'retry up to three times')
    const secondId = await recordDecision(fx, thread.threadId, 'Retry five times', 'retry up to five times', {
      supersedes: [firstId]
    })

    const live = await search(fx, {})
    assert.ok(!live.results.includes(firstId), `the default live search listed the superseded decision:\n${live.results}`)
    lineNaming(live.results, secondId)

    const all = await search(fx, { status: 'all' })
    const supersededLine = lineNaming(all.results, firstId)
    assert.ok(supersededLine.includes('superseded by'), `the superseded decision is not marked: ${supersededLine}`)
    assert.ok(supersededLine.includes(secondId), `the superseded decision does not name its replacement: ${supersededLine}`)
    assert.equal(all.matched, live.matched + 1)
  })
})
