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

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`focus fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-focus-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Focus Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'focus@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook focus fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const withFixture = async (fn: (fx: Fixture) => Promise<void>, env: Record<string, string> = {}): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-focus-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-focus-home-'))
  const spawned = await spawnServer({
    projectRoot: repo,
    entry: ENTRY,
    env: { CLAUDE_PLUGIN_DATA: pluginData, ...env }
  })
  try {
    await fn({ spawned, repo, pluginData, homeDir })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const assertRefusalOnFocus = (result: CallToolResult, unknownId: string): void => {
  assert.equal(result.isError, true, 'expected the call to be refused')
  const text = firstTextOf(result)
  const lines = text.split('\n')
  assert.equal(lines[0], 'field: focus', `expected the refusal to name field "focus", got "${lines[0]}"`)
  assert.match(text, /^accepted: /m)
  assert.match(text, /^example: /m)
  assert.match(text, /^retryable: (true|false)/m)
  assert.ok(
    text.includes(`focus names ids not present on this thread: ${unknownId}`),
    `expected the refusal message to name the focus id that names no criterion on this thread, got: ${text}`
  )
}

const createFixtureThread = async (
  spawned: SpawnedServer,
  overrides: Record<string, unknown> = {}
): Promise<{ threadId: string; criterionId: string }> => {
  const result = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'focus fixture thread',
      slug: 'focus-fixture-thread',
      completion_criteria: [{ text: 'a focus fixture criterion', check: 'a focus fixture check' }],
      ...overrides
    }
  })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const firstCriterion = structured.completion_criteria[0]
  assert.ok(firstCriterion !== undefined, 'focus fixture: open_thread arrange call minted no completion criteria')
  return { threadId: structured.thread_id, criterionId: firstCriterion.id }
}

test('resume_thread.records-focus-and-the-briefing-shows-it', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('resume_thread', resumed)
    const structured = resumed.structuredContent as { focus: string[]; briefing: string }
    assert.deepEqual(structured.focus, [criterionId])
    assert.ok(
      structured.briefing.includes('**Focus:** c1.'),
      'the returned briefing must name the focused criterion by its display label'
    )
  })
})

test('resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned)
    const unknownId = testRuntime().ulid()

    const result = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [unknownId] }
    })) as CallToolResult
    assertRefusalOnFocus(result, unknownId)
  })
})
