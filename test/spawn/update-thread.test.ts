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
    const structured = settled.structuredContent as { criteria_settled: string[] }
    assert.deepEqual(structured.criteria_settled, [criterionId], 'the reply has to name the criterion this call settled')

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
    assert.equal(
      storedCriterion(fx, opened.threadId, criterionId).settledness,
      'proposed',
      'a refused call must not have written the confirmation first'
    )
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
