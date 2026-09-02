import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { testRuntime } from '../support/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`completions fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-completions-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Completions Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'completions@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook completions fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-completions-plugin-data-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await fn({ spawned, repo, pluginData })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

type SeededThread = { threadId: string; slug: string }

const openThread = async (spawned: SpawnedServer, slug: string, title: string): Promise<SeededThread> => {
  const result = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: { title, slug, completion_criteria: [{ text: 'a completions fixture criterion', check: 'the completions fixture check' }] }
  })) as CallToolResult
  assertOkResult('open_thread (completions fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string }
  return { threadId: structured.thread_id, slug }
}

const seedThreads = async (spawned: SpawnedServer, count: number, prefix: string): Promise<SeededThread[]> => {
  const seeded: SeededThread[] = []
  for (let index = 0; index < count; index += 1) {
    const slug = `${prefix}-${index}`
    seeded.push(await openThread(spawned, slug, `completions fixture thread ${index}`))
  }
  return seeded
}

test('completion.offers-real-threads', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const threads = await seedThreads(fx.spawned, 3, 'offers-real')

    const resourceCompletion = await fx.spawned.client.complete({
      ref: { type: 'ref/resource', uri: 'logbook://thread/{id}' },
      argument: { name: 'id', value: '' }
    })
    const resourceValues = resourceCompletion.completion.values
    for (const thread of threads) {
      assert.ok(resourceValues.includes(thread.threadId), `expected the resource completion to offer ${thread.threadId}`)
    }
    assert.equal(
      resourceValues.some((value) => !threads.some((t) => t.threadId === value || t.slug === value)),
      false,
      'the resource completion must not offer an invented value'
    )

    const promptCompletion = await fx.spawned.client.complete({
      ref: { type: 'ref/prompt', name: 'preflight' },
      argument: { name: 'thread', value: '' }
    })
    const promptValues = promptCompletion.completion.values
    for (const thread of threads) {
      assert.ok(promptValues.includes(thread.threadId), `expected the preflight prompt completion to offer ${thread.threadId}`)
    }
    assert.equal(
      promptValues.some((value) => !threads.some((t) => t.threadId === value || t.slug === value)),
      false,
      'the preflight prompt completion must not offer an invented value'
    )

    const someSlug = threads[0]?.slug
    assert.ok(someSlug !== undefined)
    const slugCompletion = await fx.spawned.client.complete({
      ref: { type: 'ref/resource', uri: 'logbook://thread/{id}' },
      argument: { name: 'id', value: someSlug }
    })
    assert.ok(
      slugCompletion.completion.values.includes(someSlug),
      'expected a slug prefix match to offer the slug itself as a completion'
    )

    const resolvedBySlug = await fx.spawned.client.readResource({ uri: `logbook://thread/${someSlug}` })
    assert.ok(resolvedBySlug.contents.length > 0, 'a slug offered as a completion must itself resolve as a thread address')
  })
})

test('completion.filters-by-prefix', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const alpha = await openThread(fx.spawned, 'alpha-unique-prefix', 'alpha thread')
    const beta = await openThread(fx.spawned, 'beta-unique-prefix', 'beta thread')
    const gamma = await openThread(fx.spawned, 'gamma-unique-prefix', 'gamma thread')

    const completion = await fx.spawned.client.complete({
      ref: { type: 'ref/resource', uri: 'logbook://thread/{id}' },
      argument: { name: 'id', value: 'alpha-unique' }
    })

    assert.ok(completion.completion.values.includes(alpha.slug))
    assert.equal(completion.completion.values.includes(beta.slug), false)
    assert.equal(completion.completion.values.includes(gamma.slug), false)
    assert.equal(completion.completion.values.includes(beta.threadId), false)
    assert.equal(completion.completion.values.includes(gamma.threadId), false)
  })
})

const PLANTED_ENTRY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const PLANTED_THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

const plantSessionEntryOutsideSessionsDir = (repo: string, pluginData: string): void => {
  const rt = testRuntime({
    env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData },
    cwd: repo
  })
  const layout = layoutFor(rt, repo)
  if (!layout.ok) throw new Error('completions traversal fixture: could not resolve store layout')
  const plantedDir = join(layout.value.records, 'PLANTEDDIR')
  mkdirSync(plantedDir, { recursive: true })
  writeFileSync(
    join(plantedDir, `${PLANTED_ENTRY_ID}.json`),
    JSON.stringify({
      id: PLANTED_ENTRY_ID,
      thread_id: PLANTED_THREAD_ID,
      actor: 'claude',
      body: 'a planted session entry outside records/sessions',
      created_at: '2024-01-01T00:00:00.000Z'
    })
  )
}

test('completion.session-entry-ids-refuses-a-traversal-thread-id', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const thread = await openThread(fx.spawned, 'traversal-fixture-thread', 'traversal fixture thread')
    plantSessionEntryOutsideSessionsDir(fx.repo, fx.pluginData)

    const traversalCompletion = await fx.spawned.client.complete({
      ref: { type: 'ref/resource', uri: 'logbook://session/{thread_id}/{entry_id}' },
      argument: { name: 'entry_id', value: '' },
      context: { arguments: { thread_id: '../PLANTEDDIR' } }
    })

    assert.deepEqual(
      traversalCompletion.completion.values,
      [],
      `expected a traversal thread_id to yield no completion values, got ${JSON.stringify(traversalCompletion.completion.values)}`
    )

    const legitimate = (await fx.spawned.client.callTool({
      name: 'log_session_event',
      arguments: { thread_id: thread.threadId, actor: 'claude', body: 'a legitimate session entry' }
    })) as CallToolResult
    assertOkResult('log_session_event (traversal fixture control)', legitimate)
    const legitimateEntryId = (legitimate.structuredContent as { session_entry_id: string }).session_entry_id

    const legitimateCompletion = await fx.spawned.client.complete({
      ref: { type: 'ref/resource', uri: 'logbook://session/{thread_id}/{entry_id}' },
      argument: { name: 'entry_id', value: '' },
      context: { arguments: { thread_id: thread.threadId } }
    })
    assert.ok(
      legitimateCompletion.completion.values.includes(legitimateEntryId),
      'expected a real thread_id to still offer its own session entry ids'
    )
  })
})

test('completion.is-bounded', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    await seedThreads(fx.spawned, 300, 'bounded')

    const completion = await fx.spawned.client.complete({
      ref: { type: 'ref/resource', uri: 'logbook://thread/{id}' },
      argument: { name: 'id', value: 'bounded-' }
    })

    assert.equal(completion.completion.values.length, 100)
    assert.equal(completion.completion.hasMore, true)
    assert.equal(completion.completion.total, 300)
  })
})
