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

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`amend-criteria fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-amend-criteria-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Amend Criteria Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'amend-criteria@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook amend-criteria fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-amend-criteria-plugin-data-'))
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

const assertOkResult = (label: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${label} refused: ${JSON.stringify(result.content)}`)
}

const openFixtureThread = async (fx: Fixture, slug: string): Promise<string> => {
  const opened = (await fx.spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: `amend-criteria fixture thread ${slug}`,
      slug,
      active_goal: 'exercise the amend-criteria fixture',
      next_step: 'exercise the amend-criteria fixture'
    }
  })) as CallToolResult
  assertOkResult('open_thread (amend-criteria fixture arrange)', opened)
  return (opened.structuredContent as { thread_id: string }).thread_id
}

const recordFixtureDecision = async (fx: Fixture, threadId: string, slug: string): Promise<string> => {
  const recorded = (await fx.spawned.client.callTool({
    name: 'record_decision',
    arguments: {
      thread_id: threadId,
      title: `amend-criteria fixture decision ${slug}`,
      context: 'a decision recorded so an insert has something to resolve against',
      options: ['insert the criterion', 'leave the thread alone'],
      outcome: 'insert the criterion'
    }
  })) as CallToolResult
  assertOkResult('record_decision (amend-criteria fixture arrange)', recorded)
  return (recorded.structuredContent as { decision_id: string }).decision_id
}

const openInsertFixture = async (fx: Fixture, slug: string): Promise<{ threadId: string; decisionId: string }> => {
  const threadId = await openFixtureThread(fx, slug)
  const decisionId = await recordFixtureDecision(fx, threadId, slug)
  return { threadId, decisionId }
}

const callAmendCriteria = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'amend_criteria', arguments: args })) as CallToolResult

test('amend_criteria.refuses-an-insert-with-no-settledness', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId } = await openInsertFixture(fx, 'no-settledness')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'the suite is green',
      check: 'npm test exits 0'
    })

    assert.equal(reply.isError, true, 'settledness is declared at creation and never derived')
  })
})

test('amend_criteria.refuses-a-proposed-insert-with-no-check', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId } = await openInsertFixture(fx, 'proposed-no-check')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'the suite is green',
      settledness: 'proposed'
    })

    assert.equal(reply.isError, true, 'a proposed criterion asserts something, so something must decide it')
  })
})

test('amend_criteria.accepts-an-unsettled-insert-with-no-check', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId } = await openInsertFixture(fx, 'unsettled-no-check')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'what counts as acceptable latency is not decided',
      settledness: 'unsettled'
    })

    assert.equal(reply.isError, undefined, 'an unsettled criterion asserts nothing, so there is no claim for a check to decide')
  })
})

test('amend_criteria.refuses-a-confirmed-insert-with-no-quote', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId } = await openInsertFixture(fx, 'confirmed-no-quote')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'the suite is green',
      check: 'npm test exits 0',
      settledness: 'confirmed'
    })

    assert.equal(reply.isError, true, 'claiming the human confirmed a criterion costs typing their words')
  })
})

test('amend_criteria.refuses-a-quote-on-an-insert-nobody-confirmed', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId } = await openInsertFixture(fx, 'proposed-with-quote')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'the suite is green',
      check: 'npm test exits 0',
      settledness: 'proposed',
      settled_by: 'they said so'
    })

    assert.equal(reply.isError, true, 'a quote on a criterion nobody confirmed attributes words to nobody')
  })
})

test('amend_criteria.accepts-all-three-settledness-values-on-insert', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId } = await openInsertFixture(fx, 'all-three-values')

    const proposed = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'the suite is green',
      check: 'npm test exits 0',
      settledness: 'proposed'
    })
    const confirmed = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'the gate fires',
      check: 'the stop-gate tests pass',
      settledness: 'confirmed',
      settled_by: 'it has to block'
    })
    const unsettled = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      kind: 'planned',
      text: 'what counts as acceptable latency is not decided',
      settledness: 'unsettled'
    })

    assert.equal(proposed.isError, undefined, 'no call is ever refused because of the settledness value itself')
    assert.equal(confirmed.isError, undefined, 'no call is ever refused because of the settledness value itself')
    assert.equal(unsettled.isError, undefined, 'no call is ever refused because of the settledness value itself')
  })
})
