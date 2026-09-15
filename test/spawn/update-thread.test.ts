import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { openStore } from '../../src/store/records.ts'
import { escapeStored } from '../../src/render/escape.ts'
import type { Thread } from '../../src/schema/thread.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`update-thread fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-update-thread-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Update Thread Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'update-thread@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook update-thread fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-update-thread-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-update-thread-home-'))
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

const callOpenThread = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'open_thread', arguments: args })) as CallToolResult

const callUpdateThread = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'update_thread', arguments: args })) as CallToolResult

const readThreadRecord = (fx: Fixture, threadId: string): Thread => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`update-thread fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`update-thread fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

test('update_thread.refuses-marking-an-unsettled-criterion-done', async () => {
  await withFixture(async (fx) => {
    const opened = await callOpenThread(fx, {
      title: 'unsettled-criterion thread',
      slug: 'unsettled-criterion-thread',
      active_goal: 'exercise the unsettled-criterion fixture',
      next_step: 'exercise the unsettled-criterion fixture',
      completion_criteria: [{ text: 'what counts as acceptable latency is not decided', settledness: 'unsettled' }]
    })
    assert.equal(opened.isError, undefined, 'an unsettled criterion asserts nothing, so open_thread accepts it with no check')
    const openedStructured = opened.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
    const threadId = openedStructured.thread_id
    const unsettledId = openedStructured.completion_criteria[0]?.id
    assert.ok(unsettledId !== undefined, 'unsettled-criterion fixture: open_thread minted no completion criteria')

    const markDone = await callUpdateThread(fx, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: unsettledId, result: 'the check was run', result_status: 'verified' }]
    })

    assert.equal(markDone.isError, true, 'an unsettled criterion cannot be marked done')
    const text = firstTextOf(markDone)
    assert.ok(
      text.includes('asserts nothing'),
      `the refusal has to say why an unsettled criterion takes no result, got: ${text}`
    )

    const stored = readThreadRecord(fx, threadId)
    const criterion = stored.completion_criteria.find((c) => c.id === unsettledId)
    assert.ok(criterion !== undefined, 'the unsettled criterion vanished from the stored thread')
    assert.equal(criterion.done, false, 'a refused call must not have written the criterion done first')
    assert.equal(criterion.result ?? null, null, 'a refused call must not have written a result')
  })
})

const callRecordDecision = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'record_decision', arguments: args })) as CallToolResult

const callAmendCriteria = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'amend_criteria', arguments: args })) as CallToolResult

type OpenedCriteria = { threadId: string; criterionIds: string[] }

const openCriteriaThread = async (
  fx: Fixture,
  slug: string,
  criteria: Record<string, unknown>[]
): Promise<OpenedCriteria> => {
  const opened = await callOpenThread(fx, {
    title: `${slug} thread`,
    slug,
    active_goal: `exercise the ${slug} fixture`,
    next_step: `exercise the ${slug} fixture`,
    completion_criteria: criteria
  })
  assert.equal(
    opened.isError,
    undefined,
    `update-thread fixture: open_thread refused the ${slug} fixture: ${firstTextOf(opened)}`
  )
  const structured = opened.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  return { threadId: structured.thread_id, criterionIds: structured.completion_criteria.map((c) => c.id) }
}

const criterionAt = (opened: OpenedCriteria, index: number): string => {
  const id = opened.criterionIds[index]
  assert.ok(id !== undefined, `update-thread fixture: open_thread minted no criterion at position ${index}`)
  return id
}

const storedCriterion = (fx: Fixture, threadId: string, criterionId: string) => {
  const criterion = readThreadRecord(fx, threadId).completion_criteria.find((c) => c.id === criterionId)
  assert.ok(criterion !== undefined, 'update-thread fixture: the criterion under test vanished from the stored thread')
  return criterion
}

const PROPOSED_CRITERION = {
  text: 'the queue drains under load',
  check: 'the load test exits 0',
  settledness: 'proposed'
}

const CONFIRMED_CRITERION = {
  text: 'the gate blocks before the turn ends',
  check: 'the stop-gate tests pass',
  settledness: 'confirmed',
  settled_by: 'it has to block before the turn ends'
}

const UNSETTLED_CRITERION = {
  text: 'what counts as acceptable latency is not decided',
  settledness: 'unsettled'
}

const CHECKED_UNSETTLED_CRITERION = {
  text: 'what counts as acceptable latency is not decided',
  check: 'the latency budget the human names is met',
  settledness: 'unsettled'
}

const HUMAN_WORDS = 'it has to block before the turn ends'

test('update_thread.records-a-confirmation-with-the-human-words', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-confirmation-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed', settled_by: HUMAN_WORDS }]
    })

    assert.equal(
      settled.isError,
      undefined,
      `an answer the human gave about a criterion has somewhere to land, got: ${firstTextOf(settled)}`
    )
    const structured = settled.structuredContent as { criteria_newly_settled: string[] }
    assert.deepEqual(
      structured.criteria_newly_settled,
      [criterionId],
      'the reply has to name the criterion this call settled, under a name no caller reads back as the argument they sent'
    )

    const criterion = storedCriterion(fx, opened.threadId, criterionId)
    assert.equal(criterion.settledness, 'confirmed', 'the answer has to land on the criterion it was about')
    assert.equal(criterion.settled_by, HUMAN_WORDS, 'the human words behind a confirmation are stored verbatim')
  })
})

test('update_thread.taking-a-confirmation-back-clears-the-quote', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-retraction-thread', [CONFIRMED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'proposed' }]
    })

    assert.equal(settled.isError, undefined, `a confirmation can be taken back, got: ${firstTextOf(settled)}`)
    const criterion = storedCriterion(fx, opened.threadId, criterionId)
    assert.equal(criterion.settledness, 'proposed', 'a criterion moves back off confirmed like any other transition')
    assert.equal(criterion.settled_by, null, 'the quote belongs to the confirmation, so leaving confirmed drops it')
  })
})

test('update_thread.refuses-a-criterion-id-repeated-in-one-settlement', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-duplicate-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [
        { criterion_id: criterionId, settledness: 'unsettled' },
        { criterion_id: criterionId, settledness: 'proposed' }
      ]
    })

    assert.equal(settled.isError, true, 'two answers about one criterion in one call leave no single value to store')
    const text = firstTextOf(settled)
    assert.ok(text.includes('more than once'), `the refusal has to say the id was repeated, got: ${text}`)
    assert.equal(
      storedCriterion(fx, opened.threadId, criterionId).settledness,
      'proposed',
      'a refused call must not have written either settledness first'
    )
  })
})

test('update_thread.refuses-settling-a-struck-criterion', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-struck-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const decision = await callRecordDecision(fx, {
      thread_id: opened.threadId,
      title: 'the load criterion is withdrawn',
      context: 'the load criterion was replaced by a narrower one',
      options: ['keep the criterion', 'strike the criterion'],
      outcome: 'strike the criterion'
    })
    assert.equal(decision.isError, undefined, `the strike fixture needs a real decision, got: ${firstTextOf(decision)}`)
    const decisionId = (decision.structuredContent as { decision_id: string }).decision_id

    const struck = await callAmendCriteria(fx, {
      thread_id: opened.threadId,
      operation: 'strike',
      decision_id: decisionId,
      criterion_id: criterionId
    })
    assert.equal(struck.isError, undefined, `the strike fixture needs the criterion struck, got: ${firstTextOf(struck)}`)

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed', settled_by: HUMAN_WORDS }]
    })

    assert.equal(settled.isError, true, 'a criterion that was withdrawn takes no further answer about it')
    const text = firstTextOf(settled)
    assert.ok(text.includes('struck'), `the refusal has to say the criterion was struck, got: ${text}`)
    assert.equal(
      storedCriterion(fx, opened.threadId, criterionId).settledness,
      'proposed',
      'a refused call must not have written the settledness first'
    )
  })
})

test('update_thread.refuses-a-confirmation-that-carries-no-quote', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-quote-owed-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed' }]
    })

    assert.equal(settled.isError, true, 'a confirmation without the words behind it records no answer at all')
    const text = firstTextOf(settled)
    assert.ok(text.includes('carries no settled_by'), `the refusal has to name the missing quote, got: ${text}`)
    const stored = storedCriterion(fx, opened.threadId, criterionId)
    assert.equal(stored.settledness, 'proposed', 'a refused call must not have written the confirmation first')
    assert.equal(stored.settled_by ?? null, null, 'a refused call must not have written a quote either')
  })
})

test('update_thread.refuses-a-quote-on-a-criterion-that-is-not-confirmed', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-quote-not-owed-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'unsettled', settled_by: HUMAN_WORDS }]
    })

    assert.equal(settled.isError, true, 'a quote stands behind a confirmation and behind nothing else')
    const text = firstTextOf(settled)
    assert.ok(text.includes('carries a settled_by quote'), `the refusal has to name the stray quote, got: ${text}`)
    assert.equal(
      storedCriterion(fx, opened.threadId, criterionId).settled_by ?? null,
      null,
      'a refused call must not have written the stray quote first'
    )
  })
})

test('update_thread.accepts-all-three-settledness-values-in-one-call', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-every-value-thread', [
      PROPOSED_CRITERION,
      CONFIRMED_CRITERION,
      CHECKED_UNSETTLED_CRITERION
    ])
    const toUnsettled = criterionAt(opened, 0)
    const toProposed = criterionAt(opened, 1)
    const toConfirmed = criterionAt(opened, 2)
    const latencyWords = 'anything under two hundred milliseconds is fine'

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [
        { criterion_id: toUnsettled, settledness: 'unsettled' },
        { criterion_id: toProposed, settledness: 'proposed' },
        { criterion_id: toConfirmed, settledness: 'confirmed', settled_by: latencyWords }
      ]
    })

    assert.equal(
      settled.isError,
      undefined,
      `no settledness value is a reason to refuse a call, got: ${firstTextOf(settled)}`
    )
    assert.equal(storedCriterion(fx, opened.threadId, toUnsettled).settledness, 'unsettled')
    assert.equal(storedCriterion(fx, opened.threadId, toProposed).settledness, 'proposed')
    assert.equal(storedCriterion(fx, opened.threadId, toConfirmed).settledness, 'confirmed')
    assert.equal(storedCriterion(fx, opened.threadId, toConfirmed).settled_by, latencyWords)
  })
})

test('update_thread.refuses-leaving-a-criterion-done-and-unsettled-in-one-call', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'done-and-unsettled-one-call-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const bothAtOnce = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_done: [{ criterion_id: criterionId, result: 'the load test exited 0', result_status: 'verified' }],
      criteria_settled: [{ criterion_id: criterionId, settledness: 'unsettled' }]
    })

    assert.equal(
      bothAtOnce.isError,
      true,
      'one call cannot both report a result and say done is not known for the same criterion'
    )
    const text = firstTextOf(bothAtOnce)
    assert.ok(
      text.includes('asserts nothing'),
      `the refusal has to say why an unsettled criterion takes no result, got: ${text}`
    )
    assert.ok(
      text.includes('criteria_settled'),
      `the refusal has to name the argument that made the criterion unsettled, got: ${text}`
    )

    const stored = storedCriterion(fx, opened.threadId, criterionId)
    assert.equal(stored.done, false, 'a refused call must not have written the criterion done first')
    assert.equal(stored.settledness, 'proposed', 'a refused call must not have written the settledness first')
    assert.equal(stored.result ?? null, null, 'a refused call must not have written a result')
  })
})

test('update_thread.refuses-unsettling-a-criterion-already-marked-done', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'done-then-unsettled-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const markedDone = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_done: [{ criterion_id: criterionId, result: 'the load test exited 0', result_status: 'verified' }]
    })
    assert.equal(
      markedDone.isError,
      undefined,
      `the fixture needs the criterion marked done, got: ${firstTextOf(markedDone)}`
    )

    const unsettled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'unsettled' }]
    })

    assert.equal(unsettled.isError, true, 'a later call cannot unsettle a criterion that already carries a recorded result')
    const text = firstTextOf(unsettled)
    assert.ok(
      text.includes('asserts nothing'),
      `the refusal has to say why an unsettled criterion carries no result, got: ${text}`
    )

    const stored = storedCriterion(fx, opened.threadId, criterionId)
    assert.equal(stored.settledness, 'proposed', 'a refused call must not have written the settledness')
    assert.equal(stored.done, true, 'the criterion the earlier call marked done stays done')
  })
})

test('update_thread.refuses-settling-a-checkless-criterion-to-one-that-asserts-something', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-check-owed-thread', [UNSETTLED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const confirmed = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed', settled_by: HUMAN_WORDS }]
    })

    assert.equal(confirmed.isError, true, 'a criterion that asserts something needs something to decide it')
    const text = firstTextOf(confirmed)
    assert.ok(text.includes('carries no check'), `the refusal has to name the missing check, got: ${text}`)
    assert.ok(text.includes('amend_criteria'), `the refusal has to say where a check is given, got: ${text}`)

    const afterConfirm = storedCriterion(fx, opened.threadId, criterionId)
    assert.equal(afterConfirm.settledness, 'unsettled', 'a refused call must not have written the confirmation')
    assert.equal(afterConfirm.settled_by ?? null, null, 'a refused call must not have written the quote')

    const proposed = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'proposed' }]
    })

    assert.equal(proposed.isError, true, 'a proposed criterion asserts something too, so it owes a check as well')
    assert.ok(
      firstTextOf(proposed).includes('carries no check'),
      `the refusal has to name the missing check for proposed too, got: ${firstTextOf(proposed)}`
    )
    assert.equal(
      storedCriterion(fx, opened.threadId, criterionId).settledness,
      'unsettled',
      'a refused call must not have written the proposal'
    )
  })
})

test('update_thread.settles-a-criterion-after-amend_criteria-rewrite-gave-it-a-check', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'settlement-rewrite-then-settle-thread', [UNSETTLED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const decision = await callRecordDecision(fx, {
      thread_id: opened.threadId,
      title: 'the latency budget is now decided',
      context: 'the human named a latency budget for this criterion',
      options: ['leave it unsettled', 'give it a check and settle it'],
      outcome: 'give it a check and settle it'
    })
    assert.equal(
      decision.isError,
      undefined,
      `the rewrite-then-settle fixture needs a real decision, got: ${firstTextOf(decision)}`
    )
    const decisionId = (decision.structuredContent as { decision_id: string }).decision_id

    const rewritten = await callAmendCriteria(fx, {
      thread_id: opened.threadId,
      operation: 'rewrite',
      decision_id: decisionId,
      criterion_id: criterionId,
      text: UNSETTLED_CRITERION.text,
      check: 'the latency budget the human named is met'
    })
    assert.equal(
      rewritten.isError,
      undefined,
      `the remedy the check-owed refusal names has to actually work, got: ${firstTextOf(rewritten)}`
    )

    const settled = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed', settled_by: HUMAN_WORDS }]
    })

    assert.equal(
      settled.isError,
      undefined,
      `a check just given through an amend_criteria rewrite has to be enough to settle the criterion it was given to, got: ${firstTextOf(settled)}`
    )

    const stored = storedCriterion(fx, opened.threadId, criterionId)
    assert.equal(stored.settledness, 'confirmed', 'the settlement has to land on the criterion the check was given to')
    assert.equal(
      stored.check,
      'the latency budget the human named is met',
      'the check the rewrite supplied has to be the check the criterion carries afterward'
    )
  })
})

test('update_thread.stores-an-artifact-label-and-pointer-escaped', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'artifact-escape-thread', [PROPOSED_CRITERION])
    const label = '# Forged heading <b>'
    const pointer = '- docs/specs/forged.md'

    const result = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      artifacts_add: [{ label, pointer }]
    })
    assert.equal(
      result.isError,
      undefined,
      `update_thread must accept the artifact, got: ${result.isError === true ? firstTextOf(result) : 'no error'}`
    )

    const artifact = (readThreadRecord(fx, opened.threadId).artifacts ?? [])[0]
    assert.notEqual(escapeStored(label), label, 'the fixture label must change when escaped, or this test proves nothing')
    assert.equal(artifact?.label, escapeStored(label), 'the stored artifact label must be escaped like every other stored string')
    assert.equal(artifact?.pointer, escapeStored(pointer), 'the stored artifact pointer must be escaped like every other stored string')
  })
})

test('update_thread.refuses-a-risk-that-declares-no-anchor', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'risk-anchor-owed-thread', [PROPOSED_CRITERION])

    const result = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text: 'the queue may starve under load', scope: 'throughput' }]
    })

    assert.equal(result.isError, true, 'a risk that declares neither a criterion nor the whole thread must be refused')
    const text = firstTextOf(result)
    assert.ok(text.includes('criterion_id'), `the refusal has to name the missing anchor field, got: ${text}`)
    assert.deepEqual(readThreadRecord(fx, opened.threadId).spine.open_risks, [], 'a refused call must not have stored the risk')
  })
})

test('update_thread.stores-a-whole-thread-risk-with-a-null-anchor', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'risk-anchor-whole-thread', [PROPOSED_CRITERION])
    const riskText = 'the release may slip past the freeze'

    const result = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text: riskText, scope: 'release', criterion_id: null }]
    })
    assert.equal(
      result.isError,
      undefined,
      `update_thread must accept null as the whole-thread anchor, got: ${result.isError === true ? firstTextOf(result) : 'no error'}`
    )

    const [risk] = readThreadRecord(fx, opened.threadId).spine.open_risks
    assert.ok(risk !== undefined, 'the whole-thread risk was not stored')
    assert.equal(risk.text, riskText)
    assert.ok(Object.hasOwn(risk, 'criterion_id'), 'the stored risk must carry its declared anchor, not omit it')
    assert.equal(risk.criterion_id, null, 'a whole-thread risk is stored with a null anchor')

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: opened.threadId }
    })) as CallToolResult
    assert.equal(resumed.isError, undefined, `resume_thread must read a thread holding a null-anchored risk, got: ${firstTextOf(resumed)}`)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    assert.ok(briefing.includes(riskText), `the briefing must show the whole-thread risk, got:\n${briefing}`)
  })
})

type RiskAddResult = { risks_added: string[]; risks_already_present?: string[] }

test('update_thread.returns-the-live-risk-for-a-duplicate-instead-of-adding-it', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'risk-duplicate-thread', [PROPOSED_CRITERION])

    const first = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text: 'The queue may starve under load', scope: 'throughput', criterion_id: null }]
    })
    assert.equal(first.isError, undefined, `the first risk must be added, got: ${first.isError === true ? firstTextOf(first) : 'no error'}`)
    const firstId = (first.structuredContent as RiskAddResult).risks_added[0]
    assert.ok(firstId !== undefined, 'the first risk was not minted an id')

    const second = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text: '  the QUEUE may\tstarve   under load ', scope: 'a different scope', criterion_id: null }]
    })
    assert.equal(second.isError, undefined, `a duplicate risk must not be refused, got: ${second.isError === true ? firstTextOf(second) : 'no error'}`)
    const structured = second.structuredContent as RiskAddResult
    assert.deepEqual(structured.risks_added, [], 'a duplicate of a live risk must not mint a new risk')
    assert.deepEqual(structured.risks_already_present, [firstId], 'the duplicate must return the id of the live risk it matched')
    assert.ok(firstTextOf(second).includes(firstId), `the reply must say which live risk the duplicate matched, got: ${firstTextOf(second)}`)

    const stored = readThreadRecord(fx, opened.threadId).spine.open_risks
    assert.deepEqual(stored.map((risk) => risk.id), [firstId], 'the thread must still hold exactly the one risk')
  })
})

test('update_thread.collapses-identical-risks-in-one-call-into-one-risk', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'risk-duplicate-in-call-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)

    const result = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [
        { text: 'the load test may be flaky', scope: 'verification', criterion_id: criterionId },
        { text: 'The load test may be FLAKY', scope: 'verification', criterion_id: criterionId }
      ]
    })
    assert.equal(result.isError, undefined, `identical risks in one call must not be refused, got: ${result.isError === true ? firstTextOf(result) : 'no error'}`)
    const structured = result.structuredContent as RiskAddResult
    assert.equal(structured.risks_added.length, 1, 'two entries saying the same thing on the same anchor must mint one risk')
    assert.deepEqual(structured.risks_already_present, [], 'no risk was live before this call')
    assert.equal(readThreadRecord(fx, opened.threadId).spine.open_risks.length, 1, 'the thread must hold exactly one risk')
  })
})

test('update_thread.adds-a-risk-whose-text-matches-a-live-risk-on-another-anchor', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'risk-other-anchor-thread', [PROPOSED_CRITERION])
    const criterionId = criterionAt(opened, 0)
    const text = 'the cache may serve stale entries'

    const whole = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text, scope: 'caching', criterion_id: null }]
    })
    assert.equal(whole.isError, undefined, `the whole-thread risk must be added, got: ${whole.isError === true ? firstTextOf(whole) : 'no error'}`)

    const anchored = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text, scope: 'caching', criterion_id: criterionId }]
    })
    assert.equal(anchored.isError, undefined, `the anchored risk must be added, got: ${anchored.isError === true ? firstTextOf(anchored) : 'no error'}`)
    const structured = anchored.structuredContent as RiskAddResult
    assert.equal(structured.risks_added.length, 1, 'the same text on a different anchor is a different risk')
    assert.deepEqual(structured.risks_already_present, [])
    assert.equal(readThreadRecord(fx, opened.threadId).spine.open_risks.length, 2)
  })
})

test('update_thread.adds-again-a-risk-retired-in-the-same-call', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'risk-retire-and-add-thread', [PROPOSED_CRITERION])
    const text = 'the backfill may count rows twice'

    const first = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text, scope: 'backfill', criterion_id: null }]
    })
    const firstId = (first.structuredContent as RiskAddResult).risks_added[0]
    assert.ok(firstId !== undefined, 'the first risk was not minted an id')

    const both = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_retire: [firstId],
      risks_add: [{ text, scope: 'backfill', criterion_id: null }]
    })
    assert.equal(both.isError, undefined, `retiring and re-adding in one call must succeed, got: ${both.isError === true ? firstTextOf(both) : 'no error'}`)
    const structured = both.structuredContent as RiskAddResult
    assert.equal(structured.risks_added.length, 1, 'a risk retired in this same call is no longer live, so its text is added again')
    assert.deepEqual(structured.risks_already_present, [])
    assert.deepEqual(
      readThreadRecord(fx, opened.threadId).spine.open_risks.map((risk) => [risk.id === firstId, risk.retired]),
      [
        [true, true],
        [false, false]
      ],
      'the first risk is retired and a new live risk holds the same text'
    )
  })
})

test('update_thread.adds-a-risk-whose-text-matches-only-a-retired-risk', async () => {
  await withFixture(async (fx) => {
    const opened = await openCriteriaThread(fx, 'risk-retired-match-thread', [PROPOSED_CRITERION])
    const text = 'the migration may lock the table'

    const first = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text, scope: 'migration', criterion_id: null }]
    })
    const firstId = (first.structuredContent as RiskAddResult).risks_added[0]
    assert.ok(firstId !== undefined, 'the first risk was not minted an id')

    const retired = await callUpdateThread(fx, { thread_id: opened.threadId, risks_retire: [firstId] })
    assert.equal(retired.isError, undefined, `the risk must be retired, got: ${retired.isError === true ? firstTextOf(retired) : 'no error'}`)

    const again = await callUpdateThread(fx, {
      thread_id: opened.threadId,
      risks_add: [{ text, scope: 'migration', criterion_id: null }]
    })
    const structured = again.structuredContent as RiskAddResult
    assert.equal(structured.risks_added.length, 1, 'a retired risk is not live, so the same text is added again')
    assert.deepEqual(structured.risks_already_present, [])
  })
})
