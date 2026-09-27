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
import { openStore } from '../../src/store/records.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`criterion-reopen fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-criterion-reopen-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Criterion Reopen Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'criterion-reopen@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook criterion-reopen fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-criterion-reopen-plugin-data-'))
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

const FIRST_CRITERION_TEXT = 'the reopen operation lands with its refusals'
const SECOND_CRITERION_TEXT = 'the other goal stays listed beside the reopened one'
const EARLIER_RESULT = '436 tests, 0 fail, exit 0'

type ReopenFixture = { threadId: string; criterionId: string; otherCriterionId: string; decisionId: string }

const callTool = async (fx: Fixture, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name, arguments: args })) as CallToolResult

const openReopenFixture = async (fx: Fixture, slug: string): Promise<ReopenFixture> => {
  const opened = await callTool(fx, 'open_thread', {
    title: `criterion-reopen fixture thread ${slug}`,
    slug,
    active_goal: 'exercise the criterion-reopen fixture',
    next_step: 'exercise the criterion-reopen fixture',
    next_step_records: [],
    completion_criteria: [
      { text: FIRST_CRITERION_TEXT, check: 'npm test exits 0', settledness: 'proposed' },
      { text: SECOND_CRITERION_TEXT, check: 'npm test exits 0', settledness: 'proposed' }
    ]
  })
  assertOkResult('open_thread (criterion-reopen arrange)', opened)
  const structured = opened.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const first = structured.completion_criteria[0]
  const second = structured.completion_criteria[1]
  assert.ok(first !== undefined && second !== undefined, 'criterion-reopen fixture: open_thread minted fewer than two criteria')

  const recorded = await callTool(fx, 'record_decision', {
    thread_id: structured.thread_id,
    title: `criterion-reopen fixture decision ${slug}`,
    context: 'a decision recorded so a reopen has something to resolve against',
    options: ['reopen the criterion', 'leave it marked done'],
    outcome: 'reopen the criterion'
  })
  assertOkResult('record_decision (criterion-reopen arrange)', recorded)

  return {
    threadId: structured.thread_id,
    criterionId: first.id,
    otherCriterionId: second.id,
    decisionId: (recorded.structuredContent as { decision_id: string }).decision_id
  }
}

const markDone = async (fx: Fixture, threadId: string, criterionId: string, result: string): Promise<void> => {
  const marked = await callTool(fx, 'update_thread', {
    thread_id: threadId,
    criteria_done: [{ criterion_id: criterionId, result, result_status: 'verified' }]
  })
  assertOkResult('update_thread criteria_done (criterion-reopen arrange)', marked)
}

const storeNextStepCriterion = (fx: Fixture, threadId: string, criterionId: string): void => {
  const opened = openStore(testRuntime({ env: { CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo }), fx.repo)
  if (!opened.ok) throw new Error(`criterion-reopen fixture: could not open the store: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) throw new Error(`criterion-reopen fixture: thread ${threadId} could not be read`)
  const committed = opened.value.commit(
    [{ kind: 'thread', record: { ...slot.record, spine: { ...slot.record.spine, next_step_criterion_id: criterionId } } }],
    'seed a next step criterion written before next_step_records existed'
  )
  if (!committed.ok) throw new Error(`criterion-reopen fixture: could not seed the next step criterion: ${committed.detail}`)
}

const briefingOf = async (fx: Fixture, threadId: string): Promise<string> => {
  const resumed = await callTool(fx, 'resume_thread', { thread_id: threadId, full_briefing: true })
  assertOkResult('resume_thread (criterion-reopen assert)', resumed)
  return (resumed.structuredContent as { briefing: string }).briefing
}

test('amend_criteria.reopens-a-done-criterion-keeping-its-id-and-its-earlier-result', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId, decisionId } = await openReopenFixture(fx, 'reopen-keeps-history')
    await markDone(fx, threadId, criterionId, EARLIER_RESULT)

    const doneBriefing = await briefingOf(fx, threadId)
    assert.ok(
      doneBriefing.includes(`- criterion ${criterionId}: c1 [done]`),
      `expected the criterion to render as done before the reopen; briefing was:\n${doneBriefing}`
    )

    const reopened = await callTool(fx, 'amend_criteria', {
      thread_id: threadId,
      operation: 'reopen',
      criterion_id: criterionId,
      decision_id: decisionId
    })
    assertOkResult('amend_criteria reopen', reopened)

    const structured = reopened.structuredContent as { operation: string; criterion_id: string }
    assert.equal(structured.operation, 'reopen')
    assert.equal(structured.criterion_id, criterionId, 'a reopen keeps the criterion id it was given')

    const named = await callTool(fx, 'update_thread', {
      thread_id: threadId,
      next_step: 'check the reopened criterion against its earlier result',
      next_step_records: [criterionId]
    })
    assertOkResult('update_thread next_step (criterion-reopen arrange)', named)

    const briefing = await briefingOf(fx, threadId)
    assert.ok(
      briefing.includes(`Criterion ${criterionId} `),
      `expected the reopened criterion to keep its id in the briefing; briefing was:\n${briefing}`
    )
    assert.ok(briefing.includes(', c1 reopened, '), 'expected the reopened criterion to render as reopened rather than done')
    assert.ok(!briefing.includes('[done]') && !briefing.includes(' done, '), 'expected no criterion on this thread to render as done after the reopen')
    assert.ok(
      briefing.includes(`Result: ${EARLIER_RESULT} (verified)`),
      `expected the earlier result to stay readable beside the reopened criterion; briefing was:\n${briefing}`
    )
  })
})

test('amend_criteria.refuses-a-reopen-with-no-decision', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await openReopenFixture(fx, 'reopen-needs-a-decision')
    await markDone(fx, threadId, criterionId, EARLIER_RESULT)

    const reply = await callTool(fx, 'amend_criteria', {
      thread_id: threadId,
      operation: 'reopen',
      criterion_id: criterionId
    })

    assert.equal(reply.isError, true, 'a reopen with no decision_id records no reason and is refused')
    assert.ok(
      JSON.stringify(reply.content).includes('decision_id'),
      `expected the refusal to name decision_id rather than the operation; got: ${JSON.stringify(reply.content)}`
    )

    const briefing = await briefingOf(fx, threadId)
    assert.ok(briefing.includes('[done]'), 'expected the refused reopen to leave the criterion marked done')
  })
})

test('amend_criteria.refuses-a-reopen-of-a-criterion-that-is-not-done', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId, decisionId } = await openReopenFixture(fx, 'reopen-needs-a-done-criterion')

    const reply = await callTool(fx, 'amend_criteria', {
      thread_id: threadId,
      operation: 'reopen',
      criterion_id: criterionId,
      decision_id: decisionId
    })

    assert.equal(reply.isError, true, 'a criterion that was never marked done has nothing to reopen')
    assert.ok(
      JSON.stringify(reply.content).includes('not marked done'),
      `expected the refusal to name what is wrong; got: ${JSON.stringify(reply.content)}`
    )
  })
})

test('amend_criteria.a-reopened-criterion-a-stored-next-step-names-shows-in-full-beside-every-live-risk', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId, otherCriterionId, decisionId } = await openReopenFixture(fx, 'reopen-keeps-risks-listed')

    const anchored = await callTool(fx, 'update_thread', {
      thread_id: threadId,
      risks_add: [
        { text: 'the reopen path is untested end to end', scope: 'amend_criteria', criterion_id: criterionId },
        { text: 'the other goal has its own hazard', scope: 'briefing', criterion_id: otherCriterionId }
      ]
    })
    assertOkResult('update_thread risks_add (criterion-reopen arrange)', anchored)
    storeNextStepCriterion(fx, threadId, criterionId)

    const anchoredRiskLine = `: the reopen path is untested end to end (bears on criterion ${criterionId})`
    const otherRiskLine = `: the other goal has its own hazard (bears on criterion ${otherCriterionId})`
    const assertBothRisksListed = (briefing: string, moment: string): void => {
      assert.ok(briefing.includes(anchoredRiskLine), `expected the anchored risk to be listed ${moment}; briefing was:\n${briefing}`)
      assert.ok(briefing.includes(otherRiskLine), `expected the other goal's risk to be listed ${moment}; briefing was:\n${briefing}`)
    }

    const before = await briefingOf(fx, threadId)
    assertBothRisksListed(before, 'before the criterion is marked done')
    assert.ok(before.includes(`Criterion ${criterionId} `), 'expected the stored next step criterion to be shown in full')

    await markDone(fx, threadId, criterionId, EARLIER_RESULT)

    const done = await briefingOf(fx, threadId)
    assertBothRisksListed(done, 'once its criterion is done, because the briefing has no settled lane')
    assert.equal(done.includes('**Settled items'), false, 'expected no settled lane in the briefing')

    const reopened = await callTool(fx, 'amend_criteria', {
      thread_id: threadId,
      operation: 'reopen',
      criterion_id: criterionId,
      decision_id: decisionId
    })
    assertOkResult('amend_criteria reopen', reopened)

    const after = await briefingOf(fx, threadId)
    assertBothRisksListed(after, 'after the reopen, because the briefing narrows nothing by criterion')
    assert.ok(
      after.includes(`Criterion ${criterionId} `) && after.includes(', c1 reopened, '),
      `expected the stored next step criterion to be shown in full as reopened; briefing was:\n${after}`
    )
  })
})
