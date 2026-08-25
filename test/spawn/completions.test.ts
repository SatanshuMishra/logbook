import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

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
    arguments: { title, slug, completion_criteria: ['a completions fixture criterion'] }
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
