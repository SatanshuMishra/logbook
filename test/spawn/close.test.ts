import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { generateSchemaCases, type JsonSchemaNode } from '../support/schema-arbitrary.ts'
import { testRuntime } from '../support/runtime.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = {
  spawned: SpawnedServer
  repo: string
  pluginData: string
  homeDir: string
  published: PublishedTool[]
}

type StoredPointer = { thread_id: string; written_at: string; session_id: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`close fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-close-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Close Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'close@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook close fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-close-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-close-home-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    const published = await listPublishedTools(spawned)
    await fn({ spawned, repo, pluginData, homeDir, published })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const schemaFor = (tools: PublishedTool[], name: string): JsonSchemaNode => {
  const found = tools.find((t) => t.name === name)
  if (found === undefined) throw new Error(`close: tool "${name}" was not published`)
  return found.inputSchema
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

const createFixtureThread = async (
  spawned: SpawnedServer,
  published: PublishedTool[],
  overrides: Record<string, unknown> = {}
): Promise<{ threadId: string; criterionId: string }> => {
  const schema = schemaFor(published, 'open_thread')
  const { valid } = generateSchemaCases('open_thread', schema, overrides)
  const result = (await spawned.client.callTool({ name: 'open_thread', arguments: valid })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const firstCriterion = structured.completion_criteria[0]
  assert.ok(firstCriterion !== undefined, 'close fixture: open_thread arrange call minted no completion criteria')
  return { threadId: structured.thread_id, criterionId: firstCriterion.id }
}

const callResume = async (spawned: SpawnedServer, published: PublishedTool[], threadId: string): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'resume_thread')
  const { valid } = generateSchemaCases('resume_thread', schema, { thread_id: threadId })
  return (await spawned.client.callTool({ name: 'resume_thread', arguments: valid })) as CallToolResult
}

const callPark = async (
  spawned: SpawnedServer,
  published: PublishedTool[],
  overrides: Record<string, unknown>
): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'park_thread')
  const { valid } = generateSchemaCases('park_thread', schema, overrides)
  return (await spawned.client.callTool({ name: 'park_thread', arguments: valid })) as CallToolResult
}

const callClose = async (
  spawned: SpawnedServer,
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
  if (!layout.ok) throw new Error(`close fixture: could not resolve the store layout: ${layout.message}`)
  return layout.value
}

const pointerFilePath = (layout: StoreLayout): string => join(layout.state, 'active-thread.json')

const readPointerFile = (layout: StoreLayout): StoredPointer | null => {
  let raw: string
  try {
    raw = readFileSync(pointerFilePath(layout), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`close fixture: could not read the pointer file: ${(error as Error).message}`)
  }
  return JSON.parse(raw) as StoredPointer
}

test('close.releases-the-pointer-it-owns-when-abandoned', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published, { slug: 'close-releases-abandoned' })
    await callResume(fx.spawned, fx.published, threadId)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    assert.notEqual(
      readPointerFile(layout),
      null,
      'the fixture must start with a pointer naming the thread this session just resumed'
    )

    const closed = await callClose(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: 'abandoned',
      detail: 'no longer needed for this pointer-release probe'
    })
    assertOkResult('close_thread (abandoned)', closed)

    assert.equal(
      readPointerFile(layout),
      null,
      'closing the thread that is currently marked as being worked must release the pointer, exactly as park_thread already does'
    )
  })
})

test('close.releases-the-pointer-it-owns-when-done', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned, fx.published, { slug: 'close-releases-done' })
    await callResume(fx.spawned, fx.published, threadId)

    const markDone = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: {
        thread_id: threadId,
        criteria_done: [
          { criterion_id: criterionId, result: 'the fixture check was run and returned this', result_status: 'verified' }
        ]
      }
    })) as CallToolResult
    assertOkResult('update_thread (mark criterion done before closing)', markDone)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    assert.notEqual(
      readPointerFile(layout),
      null,
      'the fixture must start with a pointer naming the thread this session just resumed'
    )

    const closed = await callClose(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: 'done',
      detail: 'shipped the health check before this pointer-release probe closes the thread'
    })
    assertOkResult('close_thread (done)', closed)

    assert.equal(
      readPointerFile(layout),
      null,
      'closing a thread as done while it is marked as being worked must release the pointer'
    )
  })
})

test('close.then-park-on-another-thread-is-not-refused-for-naming-the-closed-thread', async () => {
  await withFixture(async (fx) => {
    const a = await createFixtureThread(fx.spawned, fx.published, { slug: 'close-then-park-thread-a' })
    const b = await createFixtureThread(fx.spawned, fx.published, { slug: 'close-then-park-thread-b' })
    await callResume(fx.spawned, fx.published, a.threadId)

    const closed = await callClose(fx.spawned, fx.published, {
      thread_id: a.threadId,
      outcome: 'abandoned',
      detail: 'closed so a later park on a different thread can be attempted'
    })
    assertOkResult('close_thread (thread A, before the park on thread B)', closed)

    const park = await callPark(fx.spawned, fx.published, {
      thread_id: b.threadId,
      outcome: 'MARKER-PARK-AFTER-CLOSE this outcome targets thread B, never resumed by this session'
    })
    assert.equal(
      park.isError,
      true,
      'thread B was never resumed by this session, so park_thread must still refuse this call'
    )
    const text = firstTextOf(park)
    assert.doesNotMatch(
      text,
      new RegExp(a.threadId),
      'once thread A is closed, a park call aimed at a different open thread must not be refused for naming A as the thread currently being worked'
    )
  })
})

test('close.leaves-a-pointer-naming-another-thread', async () => {
  await withFixture(async (fx) => {
    const a = await createFixtureThread(fx.spawned, fx.published, { slug: 'close-anti-steal-thread-a' })
    const b = await createFixtureThread(fx.spawned, fx.published, { slug: 'close-anti-steal-thread-b' })
    await callResume(fx.spawned, fx.published, b.threadId)

    const closed = await callClose(fx.spawned, fx.published, {
      thread_id: a.threadId,
      outcome: 'abandoned',
      detail: 'closing an unrelated thread must not disturb the pointer naming thread B'
    })
    assertOkResult('close_thread (thread A, pointer held by thread B)', closed)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    const pointer = readPointerFile(layout)
    assert.notEqual(
      pointer,
      null,
      'closing thread A must not release a pointer that names a different thread'
    )
    assert.equal(
      pointer?.thread_id,
      b.threadId,
      'the pointer must still name thread B after an unrelated thread is closed'
    )
  })
})
