import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')
const LONG_OUTCOME_MIN_CHARS = 40_000

type Structured = Record<string, unknown>

const halt = (detail: string): never => {
  throw new Error(`step-briefing-resume fixture: ${detail}`)
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-step-briefing-repo-'))
  writeFileSync(join(repo, 'README.md'), 'logbook step briefing fixture repository\n')
  const steps = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Step Briefing Fixture'],
    ['config', 'user.email', 'step-briefing@logbook.test'],
    ['add', 'README.md'],
    ['commit', '-m', 'fixture: initial commit']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    if (result.status !== 0) halt(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return repo
}

const withSession = async <T>(repo: string, pluginData: string, fn: (spawned: SpawnedServer) => Promise<T>): Promise<T> => {
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    return await fn(spawned)
  } finally {
    await spawned.close()
  }
}

const call = async (spawned: SpawnedServer, name: string, args: Structured): Promise<CallToolResult> => {
  const result = (await spawned.client.callTool({ name, arguments: args })) as CallToolResult
  return result.isError === true ? halt(`${name} refused: ${JSON.stringify(result.content)}`) : result
}

const structuredOf = (result: CallToolResult): Structured => {
  const structured = result.structuredContent
  return typeof structured === 'object' && structured !== null ? (structured as Structured) : halt('the reply carries no structured content')
}

const stringOf = (structured: Structured, key: string): string => {
  const value = structured[key]
  return typeof value === 'string' ? value : halt(`the reply carries no string ${key}`)
}

test('briefing.resume-returns-the-whole-step-briefing', async () => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-step-briefing-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  try {
    const clause = 'every retry waits for the jitter window before it calls the gateway again '
    const outcome = `${clause.repeat(Math.ceil(LONG_OUTCOME_MIN_CHARS / clause.length))}and this is the final clause`
    assert.ok(outcome.length > LONG_OUTCOME_MIN_CHARS, 'the outcome must be longer than 40,000 characters')

    const threadId = await withSession(repo, pluginData, async (spawned) => {
      const opened = stringOf(
        structuredOf(
          await call(spawned, 'open_thread', {
            title: 'spread the gateway retries',
            slug: 'spread-gateway-retries',
            active_goal: 'keep retries from stampeding the gateway',
            next_step: 'read the gateway module',
            next_step_records: []
          })
        ),
        'thread_id'
      )
      const decisionId = stringOf(
        structuredOf(
          await call(spawned, 'record_decision', {
            thread_id: opened,
            title: 'Spread every retry',
            context: 'retries from every caller landed on the gateway in the same millisecond',
            options: [],
            outcome
          })
        ),
        'decision_id'
      )
      await call(spawned, 'update_thread', {
        thread_id: opened,
        next_step: 'apply the retry ruling',
        next_step_records: [decisionId]
      })
      return opened
    })

    const resumed = await withSession(repo, pluginData, (spawned) => call(spawned, 'resume_thread', { thread_id: threadId }))
    const briefing = stringOf(structuredOf(resumed), 'briefing')

    assert.ok(briefing.includes('**What this step needs:**'), briefing.slice(0, 2000))
    assert.ok(briefing.includes(`Outcome: ${outcome}\n`), 'the named decision must arrive with its whole outcome')
    assert.equal(briefing.includes('shortened'), false, 'the briefing must carry no shortened notice')
    assert.ok(
      resumed.content.every((block) => block.type !== 'text' || block.text === ''),
      'the briefing travels once, in the structured reply, so the reply text stays empty'
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
})
