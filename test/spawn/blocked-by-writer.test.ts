import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { escapeStored } from '../../src/render/escape.ts'
import * as caps from '../../src/schema/caps.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const BLOCKAGE_REASON = 'waiting on the infra approval'

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`blocked-by fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-blocked-by-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Blocked By Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'blocked-by@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook blocked-by fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-blocked-by-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await fn({ spawned, repo, pluginData })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const structuredOf = (label: string, result: CallToolResult): Record<string, unknown> => {
  assert.notEqual(result.isError, true, `${label} refused: ${JSON.stringify(result.content)}`)
  const structured = result.structuredContent
  if (!isRecord(structured)) throw new Error(`${label} returned no structured content`)
  return structured
}

const openThread = async (fx: Fixture, slug: string): Promise<string> => {
  const opened = (await fx.spawned.client.callTool({
    name: 'open_thread',
    arguments: { title: 'a thread that can be blocked', slug, completion_criteria: [{ text: 'the blockage renders', check: 'the roster prints it' }] }
  })) as CallToolResult
  const threadId = structuredOf('open_thread', opened).thread_id
  assert.equal(typeof threadId, 'string', 'open_thread must return a thread_id string')
  return threadId as string
}

const setBlockedBy = async (fx: Fixture, threadId: string, blockedBy: string): Promise<Record<string, unknown>> => {
  const updated = (await fx.spawned.client.callTool({
    name: 'update_thread',
    arguments: { thread_id: threadId, blocked_by: blockedBy }
  })) as CallToolResult
  return structuredOf('update_thread', updated)
}

const clearBlockedBy = async (fx: Fixture, threadId: string): Promise<Record<string, unknown>> => {
  const updated = (await fx.spawned.client.callTool({
    name: 'update_thread',
    arguments: { thread_id: threadId, blocked_by_clear: true }
  })) as CallToolResult
  return structuredOf('update_thread', updated)
}

const rosterRowFor = async (fx: Fixture, threadId: string): Promise<Record<string, unknown>> => {
  const listed = (await fx.spawned.client.callTool({ name: 'list_threads', arguments: {} })) as CallToolResult
  const structured = structuredOf('list_threads', listed)
  const threads = structured.threads
  assert.ok(Array.isArray(threads), 'list_threads must return a threads array')
  const row = (threads as unknown[]).find((candidate) => isRecord(candidate) && candidate.id === threadId)
  if (!isRecord(row)) throw new Error(`list_threads returned no row for thread ${threadId}`)
  return row
}

const refusalTextOf = (result: CallToolResult): string =>
  (result.content ?? [])
    .map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')

const fieldNameOf = (text: string): string | null => {
  const match = /^field: (.+)$/m.exec(text)
  if (match === null) return null
  const captured = match[1]
  return captured === undefined ? null : captured
}

test('blocked-by.update-thread-sets-what-a-thread-is-blocked-on', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-set')
    const before = await rosterRowFor(fx, threadId)
    assert.equal(before.blocked_by, null, 'a new thread must start with no blockage')

    const result = await setBlockedBy(fx, threadId, BLOCKAGE_REASON)
    assert.equal(result.blocked_by_set, true, 'update_thread must report that it changed the blockage')

    const after = await rosterRowFor(fx, threadId)
    assert.equal(after.blocked_by, BLOCKAGE_REASON, 'the roster row must carry the reason that was written')
  })
})

test('blocked-by.update-thread-clears-a-blockage-with-the-clear-flag', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-cleared')
    await setBlockedBy(fx, threadId, BLOCKAGE_REASON)

    const cleared = await clearBlockedBy(fx, threadId)
    assert.equal(cleared.blocked_by_set, true, 'clearing a blockage is a change and must be reported as one')

    const after = await rosterRowFor(fx, threadId)
    assert.equal(after.blocked_by, null, 'the roster row must show the blockage was cleared')
  })
})

test('blocked-by.setting-and-clearing-in-one-call-is-refused', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-conflict')
    const result = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, blocked_by: BLOCKAGE_REASON, blocked_by_clear: true }
    })) as CallToolResult
    assert.equal(result.isError, true, 'naming both a blockage and a clear in one call must refuse')
    const text = JSON.stringify(result.content)
    assert.ok(text.includes('blocked_by_clear'), `the refusal must name the field: ${text}`)

    const after = await rosterRowFor(fx, threadId)
    assert.equal(after.blocked_by, null, 'a refused call must not have written anything')
  })
})

test('blocked-by.the-published-input-schema-carries-a-top-level-type-for-both-fields', async () => {
  await withFixture(async (fx) => {
    const listed = await fx.spawned.client.listTools()
    const tool = listed.tools.find((candidate) => candidate.name === 'update_thread')
    if (tool === undefined) throw new Error('update_thread was not published')
    const schema = tool.inputSchema as unknown as Record<string, unknown>
    const properties = schema.properties
    if (!isRecord(properties)) throw new Error('update_thread published no properties object')
    for (const key of ['blocked_by', 'blocked_by_clear']) {
      const node: unknown = properties[key]
      if (!isRecord(node)) throw new Error(`update_thread published no schema for ${key}`)
      assert.equal(
        'anyOf' in node || 'oneOf' in node || 'allOf' in node,
        false,
        `${key} published a union keyword, which halts the every-property-described census`
      )
      assert.ok(typeof node.type === 'string', `${key} published no top-level type: ${JSON.stringify(node)}`)
      assert.ok(typeof node.description === 'string' && node.description.trim().length >= 10, `${key} needs a description`)
    }
  })
})

test('blocked-by.a-call-carrying-only-blocked-by-is-not-reported-as-no-change', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-not-silent')
    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, blocked_by: BLOCKAGE_REASON }
    })) as CallToolResult
    const structured = structuredOf('update_thread', updated)
    assert.equal(structured.blocked_by_set, true)
    const text = JSON.stringify(updated.content)
    assert.equal(
      text.includes('no fields were supplied'),
      false,
      'a call carrying only blocked_by must not report that nothing was supplied'
    )
  })
})

test('blocked-by.list-threads-structured-content-carries-the-escaped-form-not-raw-hostile-text', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-hostile')
    const HOSTILE_BLOCKED_BY = '# blocked pending ‮approval\nsee the linked thread for detail'

    await setBlockedBy(fx, threadId, HOSTILE_BLOCKED_BY)

    const row = await rosterRowFor(fx, threadId)
    assert.equal(
      row.blocked_by,
      escapeStored(HOSTILE_BLOCKED_BY),
      `list_threads must return the escaped form of blocked_by, not the raw hostile text it was set with: ${JSON.stringify(row.blocked_by)}`
    )
  })
})

test('blocked-by.a-value-that-only-exceeds-the-cap-after-escaping-is-refused', async () => {
  await withFixture(async (fx) => {
    const threadId = await openThread(fx, 'blocked-by-post-escape-cap')
    const RAW_BLOCKED_BY = '\n'.repeat(100)
    assert.ok(RAW_BLOCKED_BY.length <= caps.THREAD_BLOCKED_BY_MAX, 'the fixture value must pass the raw cap unmodified')
    const escapedLength = escapeStored(RAW_BLOCKED_BY).length
    assert.ok(escapedLength > caps.THREAD_BLOCKED_BY_MAX, 'the fixture value must exceed the cap only after escaping')

    const result = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, blocked_by: RAW_BLOCKED_BY }
    })) as CallToolResult

    assert.equal(result.isError, true, 'a blocked_by whose escaped form exceeds the cap must be refused')
    const text = refusalTextOf(result)
    const field = fieldNameOf(text)
    assert.equal(field, 'blocked_by', `the refusal must name field blocked_by, not thread or anything else: ${text}`)
    assert.ok(text.includes(String(caps.THREAD_BLOCKED_BY_MAX)), `the refusal must name the cap ${caps.THREAD_BLOCKED_BY_MAX}: ${text}`)
    assert.ok(text.includes(String(escapedLength)), `the refusal must name the observed post-escape length ${escapedLength}: ${text}`)

    const after = await rosterRowFor(fx, threadId)
    assert.equal(after.blocked_by, null, 'a refused call must not have written anything')
  })
})
