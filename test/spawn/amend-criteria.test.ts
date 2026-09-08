import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { readThreadResourceText } from '../support/resources-fixture.ts'
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

const STANDING_CRITERION_TEXT = 'the standing criterion nothing may quietly rewrite'

type AmendableFixture = { threadId: string; decisionId: string; criterionId: string }

const openAmendableFixture = async (fx: Fixture, slug: string): Promise<AmendableFixture> => {
  const opened = (await fx.spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: `amend-criteria fixture thread ${slug}`,
      slug,
      active_goal: 'exercise the amend-criteria fixture',
      next_step: 'exercise the amend-criteria fixture',
      completion_criteria: [
        { text: STANDING_CRITERION_TEXT, check: 'npm test exits 0', settledness: 'proposed' }
      ]
    }
  })) as CallToolResult
  assertOkResult('open_thread (amend-criteria amendable fixture arrange)', opened)
  const structured = opened.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const first = structured.completion_criteria[0]
  assert.ok(first !== undefined, 'amend-criteria fixture: open_thread minted no completion criterion to amend')
  const decisionId = await recordFixtureDecision(fx, structured.thread_id, slug)
  return { threadId: structured.thread_id, decisionId, criterionId: first.id }
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

test('amend_criteria.refuses-a-rewrite-carrying-settledness', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId, criterionId } = await openAmendableFixture(fx, 'rewrite-with-settledness')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'rewrite',
      decision_id: decisionId,
      criterion_id: criterionId,
      text: 'the rewritten criterion text',
      settledness: 'confirmed',
      settled_by: 'they said so'
    })

    assert.equal(reply.isError, true, 'a rewrite writes text, so a settledness it would drop is refused rather than accepted')

    const detail = await readThreadResourceText(fx.spawned, threadId)
    assert.ok(detail.includes(STANDING_CRITERION_TEXT), 'the refused rewrite must leave the stored criterion text alone')
    assert.ok(!detail.includes('the rewritten criterion text'), 'the refused rewrite must not have written its text')
    assert.ok(detail.includes('[proposed]'), 'the refused rewrite must not have moved the stored settledness')
  })
})

test('amend_criteria.refuses-a-rewrite-carrying-only-a-quote', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId, criterionId } = await openAmendableFixture(fx, 'rewrite-with-quote')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'rewrite',
      decision_id: decisionId,
      criterion_id: criterionId,
      text: 'the rewritten criterion text',
      settled_by: 'they said so'
    })

    assert.equal(reply.isError, true, 'a quote a rewrite would drop is refused rather than accepted')

    const detail = await readThreadResourceText(fx.spawned, threadId)
    assert.ok(detail.includes(STANDING_CRITERION_TEXT), 'the refused rewrite must leave the stored criterion text alone')
    assert.ok(!detail.includes('they said so'), 'the refused rewrite must not have stored the quote it carried')
  })
})

test('amend_criteria.rewrite-with-no-check-leaves-the-stored-check-alone', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId, criterionId } = await openAmendableFixture(fx, 'rewrite-no-check')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'rewrite',
      decision_id: decisionId,
      criterion_id: criterionId,
      text: 'the rewritten criterion text with no check supplied'
    })

    assert.equal(reply.isError, undefined, 'a rewrite naming only new text is not refused')

    const detail = await readThreadResourceText(fx.spawned, threadId)
    assert.ok(
      detail.includes('the rewritten criterion text with no check supplied'),
      'the rewrite must have written its new text'
    )
    assert.ok(
      detail.includes('check: npm test exits 0'),
      'a rewrite that omits check must leave the stored check exactly as it was'
    )
  })
})

test('amend_criteria.refuses-a-strike-carrying-settledness', async () => {
  await withFixture(async (fx) => {
    const { threadId, decisionId, criterionId } = await openAmendableFixture(fx, 'strike-with-settledness')
    const reply = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'strike',
      decision_id: decisionId,
      criterion_id: criterionId,
      settledness: 'confirmed',
      settled_by: 'they said so'
    })

    assert.equal(reply.isError, true, 'a strike writes no settledness, so one it would drop is refused rather than accepted')

    const detail = await readThreadResourceText(fx.spawned, threadId)
    assert.ok(detail.includes('[open]'), 'the refused strike must leave the criterion unstruck')
    assert.ok(!detail.includes('[struck]'), 'the refused strike must not have struck the criterion')
    assert.ok(detail.includes('[proposed]'), 'the refused strike must not have moved the stored settledness')
  })
})
