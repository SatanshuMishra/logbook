import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from './git-fixture.ts'
import { spawnServer, type SpawnedServer } from './spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

export type Fixture = {
  spawned: SpawnedServer
  repo: string
  pluginData: string
  homeDir: string
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`resources fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-resources-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Resources Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'resources@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook resources fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

export const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-resources-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-resources-home-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await fn({ spawned, repo, pluginData, homeDir })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

export const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

export type SeededIds = { threadId: string; decisionId: string; sessionThreadId: string; sessionEntryId: string }

export const seedStore = async (spawned: SpawnedServer): Promise<SeededIds> => {
  await spawned.client.listTools()

  const opened = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'resources fixture thread',
      slug: 'resources-fixture-thread',
      completion_criteria: [{ text: 'a resources fixture criterion', check: 'the resources fixture check' }]
    }
  })) as CallToolResult
  assertOkResult('open_thread (resources fixture arrange)', opened)
  const openedStructured = opened.structuredContent as { thread_id: string }
  const threadId = openedStructured.thread_id

  const decision = (await spawned.client.callTool({
    name: 'record_decision',
    arguments: {
      thread_id: threadId,
      title: 'resources fixture decision',
      context: 'a resources fixture context',
      options: ['option a', 'option b'],
      outcome: 'chose option a'
    }
  })) as CallToolResult
  assertOkResult('record_decision (resources fixture arrange)', decision)
  const decisionStructured = decision.structuredContent as { decision_id: string }
  const decisionId = decisionStructured.decision_id

  const sessionEvent = (await spawned.client.callTool({
    name: 'log_session_event',
    arguments: { thread_id: threadId, actor: 'claude', body: 'a resources fixture session entry' }
  })) as CallToolResult
  assertOkResult('log_session_event (resources fixture arrange)', sessionEvent)
  const sessionStructured = sessionEvent.structuredContent as { thread_id: string; session_entry_id: string }

  return {
    threadId,
    decisionId,
    sessionThreadId: sessionStructured.thread_id,
    sessionEntryId: sessionStructured.session_entry_id
  }
}

export const readThreadResourceText = async (spawned: SpawnedServer, threadId: string): Promise<string> => {
  const read = await spawned.client.readResource({ uri: `logbook://thread/${threadId}` })
  const [content] = read.contents
  assert.ok(
    content !== undefined && 'text' in content && typeof content.text === 'string',
    'expected logbook://thread to return text content'
  )
  return (content as { text: string }).text
}

export const readResourceText = async (spawned: SpawnedServer, uri: string): Promise<string> => {
  const read = await spawned.client.readResource({ uri })
  const [content] = read.contents
  assert.ok(
    content !== undefined && 'text' in content && typeof content.text === 'string',
    `expected ${uri} to return text content`
  )
  return (content as { text: string }).text
}
