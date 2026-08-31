import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { declare } from '../../src/schema/declare.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { updateThreadTool } from '../../src/server/tools/update_thread.ts'
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
import { closeThreadTool } from '../../src/server/tools/close_thread.ts'
import { recordDecisionTool } from '../../src/server/tools/record_decision.ts'
import type { Criterion } from '../../src/schema/thread.ts'
import { openStore } from '../../src/store/records.ts'
import * as caps from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit } from '../support/git-fixture.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const withCriterionFixture = async (fn: (rt: Runtime) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-criterion-repo-'))
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-criterion-plugin-data-'))
  try {
    rawGit(repo, ['init', '--initial-branch=main'])
    rawGit(repo, ['config', 'user.name', 'Logbook Criterion Fixture'])
    rawGit(repo, ['config', 'user.email', 'criterion@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook criterion fixture repository\n')
    rawGit(repo, ['add', 'README.md'])
    rawGit(repo, ['commit', '-m', 'fixture: initial commit'])
    await fn(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo }))
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const openFixtureThread = async (
  rt: Runtime,
  slug: string,
  criteria: { text: string; check: string }[]
): Promise<{ threadId: string; criterionIds: string[] }> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: `criterion contract fixture ${slug}`,
    slug,
    completion_criteria: criteria
  })
  if (!opened.ok) throw new Error(`criterion fixture: open_thread refused: ${opened.refusal.message}`)
  return {
    threadId: opened.structured.thread_id,
    criterionIds: opened.structured.completion_criteria.map((criterion) => criterion.id)
  }
}

const seedDecision = async (rt: Runtime, threadId: string): Promise<string> => {
  const recorded = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
    thread_id: threadId,
    title: 'the criterion fixture decision',
    context: 'a decision recorded so an amendment has something to resolve against',
    options: ['amend the criteria', 'leave them alone'],
    outcome: 'amend the criteria'
  })
  if (!recorded.ok) throw new Error(`criterion fixture: record_decision refused: ${recorded.refusal.message}`)
  return recorded.structured.decision_id
}

const readStoredCriteria = (rt: Runtime, threadId: string): Criterion[] => {
  const opened = openStore(rt, rt.cwd)
  if (!opened.ok) throw new Error('criterion fixture: the store did not open')
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) throw new Error('criterion fixture: the thread did not read back')
  return slot.record.completion_criteria
}

test('criterion.open-thread-refuses-a-criterion-carrying-no-check', () => {
  const declared = declare<unknown>(openThreadTool.name, openThreadTool.input)
  const refusal = declared.parse({
    title: 'a thread whose criterion states no check',
    slug: 'no-check-thread',
    completion_criteria: [{ text: 'the health check ships' }]
  })
  assert.equal(refusal.ok, false)
  if (refusal.ok) throw new Error('expected open_thread to refuse a criterion carrying no check')
  assert.equal(refusal.field, 'completion_criteria.0.check')
  assert.equal(refusal.retryable, true)
  assert.match(refusal.accepted, /the re-runnable check that decides whether this criterion is true/)
})

test('criterion.open-thread-stores-the-check-it-was-given', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'stores-the-check', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const stored = readStoredCriteria(rt, threadId)
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.check, 'npm test exits 0')
    assert.equal(stored[0]?.result, null)
    assert.equal(stored[0]?.result_status, null)
  })
})

test('criterion.amend-criteria-refuses-an-insert-carrying-no-check', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'insert-without-check', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const decisionId = await seedDecision(rt, threadId)
    const refused = await amendCriteriaTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      text: 'a criterion inserted with no check',
      kind: 'detour'
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected amend_criteria to refuse an insert carrying no check')
    assert.equal(refused.refusal.field, 'check')
    assert.equal(refused.refusal.accepted, 'a value for check when operation is "insert"')
    assert.equal(refused.refusal.example, 'npm test exits 0')
    assert.equal(refused.refusal.retryable, true)
    assert.equal(refused.refusal.message, 'check is required when operation is "insert".')
    assert.equal(readStoredCriteria(rt, threadId).length, 1)
  })
})

test('criterion.amend-criteria-stores-the-check-on-an-inserted-criterion', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'insert-with-check', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const decisionId = await seedDecision(rt, threadId)
    const inserted = await amendCriteriaTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      text: 'the merge test passes in both push orders',
      check: 'node --test test/sync/two-clones.test.ts exits 0',
      kind: 'detour'
    })
    assert.equal(inserted.ok, true)
    if (!inserted.ok) throw new Error('expected amend_criteria to insert a criterion carrying a check')
    const stored = readStoredCriteria(rt, threadId)
    const found = stored.find((criterion) => criterion.id === inserted.structured.criterion_id)
    assert.equal(found?.check, 'node --test test/sync/two-clones.test.ts exits 0')
  })
})

test('criterion.open-thread-refuses-a-check-that-overflows-its-cap-once-escaped', async () => {
  await withCriterionFixture(async (rt) => {
    const refused = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'a thread whose criterion check overflows its cap once escaped',
      slug: 'over-cap-check-thread',
      completion_criteria: [
        { text: 'the health check ships', check: String.fromCharCode(1).repeat(84) }
      ]
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected open_thread to refuse a check that overflows its cap once escaped')
    assert.equal(refused.refusal.field, 'completion_criteria')
    assert.equal(
      refused.refusal.accepted,
      `at most ${caps.CRITERION_CHECK_MAX} characters after escaping, per check`
    )
    assert.equal(refused.refusal.example, 'npm test exits 0')
    assert.equal(refused.refusal.retryable, true)
    assert.equal(
      refused.refusal.message,
      `completion_criteria[0].check exceeds its cap of ${caps.CRITERION_CHECK_MAX} characters after escaping; observed 504; remedy: shorten the check and retry.`
    )
    const opened = openStore(rt, rt.cwd)
    if (!opened.ok) throw new Error('criterion fixture: the store did not open')
    assert.equal(opened.value.readThreads().length, 0)
  })
})

test('criterion.criteria-done-refuses-the-bare-criterion-id-array', () => {
  const declared = declare<unknown>(updateThreadTool.name, updateThreadTool.input)
  const refusal = declared.parse({
    thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    criteria_done: ['01ARZ3NDEKTSV4RRFFQ69G5FAV']
  })
  assert.equal(refusal.ok, false)
  if (refusal.ok) throw new Error('expected update_thread to refuse a bare criterion id array')
  assert.equal(refusal.field, 'criteria_done.0')
  assert.equal(refusal.retryable, true)
  assert.match(refusal.accepted, /the bare criterion id string this argument took before is refused/)
  assert.match(refusal.accepted, /"criterion_id".*"result".*"result_status"/)
  assert.match(refusal.example, /"criterion_id"/)
  assert.match(refusal.example, /"result_status"/)
})

test('criterion.criteria-done-records-the-result-and-its-status', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'records-the-result', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const criterionId = criterionIds[0] as string
    const marked = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '436 tests, 0 fail, exit 0', result_status: 'verified' }]
    })
    assert.equal(marked.ok, true)
    if (!marked.ok) throw new Error('expected update_thread to mark the criterion done')
    assert.deepEqual(marked.structured.criteria_marked_done, [criterionId])
    const stored = readStoredCriteria(rt, threadId)
    assert.equal(stored[0]?.done, true)
    assert.equal(stored[0]?.result, '436 tests, 0 fail, exit 0')
    assert.equal(stored[0]?.result_status, 'verified')
  })
})

test('criterion.criteria-done-refuses-an-empty-result', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'empty-result', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const criterionId = criterionIds[0] as string
    const refused = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '   ', result_status: 'verified' }]
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected update_thread to refuse an empty result')
    assert.equal(refused.refusal.field, 'criteria_done')
    assert.equal(
      refused.refusal.accepted,
      'a non-empty result on every entry, stating what the check returned or why it could not be run'
    )
    assert.equal(refused.refusal.retryable, true)
    assert.match(refused.refusal.message, /a criterion is never marked done without one/)
    assert.equal(readStoredCriteria(rt, threadId)[0]?.done, false)
  })
})

test('criterion.criteria-done-refuses-an-absent-result-status', () => {
  const declared = declare<unknown>(updateThreadTool.name, updateThreadTool.input)
  const refusal = declared.parse({
    thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    criteria_done: [{ criterion_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', result: 'the check was run' }]
  })
  assert.equal(refusal.ok, false)
  if (refusal.ok) throw new Error('expected update_thread to refuse an absent result_status')
  assert.equal(refusal.field, 'criteria_done.0.result_status')
  assert.equal(refusal.example, 'verified')
  assert.match(refusal.accepted, /enum=verified,unverified-reasoned/)
})

test('criterion.criteria-done-refuses-an-id-that-names-no-criterion-on-the-thread', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'unknown-criterion', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const strangerId = rt.ulid()
    const refused = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: strangerId, result: 'the check was run', result_status: 'verified' }]
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected update_thread to refuse a criterion id that is not on the thread')
    assert.equal(refused.refusal.field, 'criteria_done')
    assert.match(refused.refusal.message, /names ids not present on this thread/)
  })
})

test('criterion.criteria-done-refuses-overwriting-a-recorded-result', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'no-overwrite', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const criterionId = criterionIds[0] as string
    const first = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '436 tests, 0 fail, exit 0', result_status: 'verified' }]
    })
    assert.equal(first.ok, true)

    const repeated = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '436 tests, 0 fail, exit 0', result_status: 'verified' }]
    })
    assert.equal(repeated.ok, true, 'resending the same result must not be refused')

    const contradiction = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: 'a different result', result_status: 'verified' }]
    })
    assert.equal(contradiction.ok, false)
    if (contradiction.ok) throw new Error('expected update_thread to refuse overwriting a recorded result')
    assert.equal(contradiction.refusal.field, 'criteria_done')
    assert.equal(contradiction.refusal.retryable, false)
    assert.equal(readStoredCriteria(rt, threadId)[0]?.result, '436 tests, 0 fail, exit 0')
  })
})

test('criterion.close-thread-prints-the-verified-and-unverified-reasoned-split', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'the-split', [
      { text: 'the health check ships', check: 'npm test exits 0' },
      { text: 'the mutation score holds', check: 'npm run mutate reports at least 75 percent' }
    ])
    const marked = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [
        { criterion_id: criterionIds[0] as string, result: '436 tests, 0 fail, exit 0', result_status: 'verified' },
        {
          criterion_id: criterionIds[1] as string,
          result: 'the mutation run takes 152 minutes and was not performed on this machine',
          result_status: 'unverified-reasoned'
        }
      ]
    })
    assert.equal(marked.ok, true)

    const closed = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      outcome: 'done',
      detail: 'shipped the criterion contract'
    })
    assert.equal(closed.ok, true)
    if (!closed.ok) throw new Error('expected close_thread to close a thread carrying an unverified-reasoned criterion')
    assert.deepEqual(closed.structured.result_status_split, {
      verified: 1,
      unverified_reasoned: 1,
      not_recorded: 0
    })
    assert.equal(
      closed.text,
      'closed thread the-split as done; criteria met: 1 verified, 1 unverified-reasoned, 0 not recorded.'
    )
  })
})

test('criterion.close-thread-refuses-on-neither-side-of-the-split', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'no-refusal', [
      { text: 'the mutation score holds', check: 'npm run mutate reports at least 75 percent' }
    ])
    const marked = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [
        {
          criterion_id: criterionIds[0] as string,
          result: 'the mutation run takes 152 minutes and was not performed on this machine',
          result_status: 'unverified-reasoned'
        }
      ]
    })
    assert.equal(marked.ok, true)

    const closed = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      outcome: 'done',
      detail: 'shipped what could be shipped and recorded what could not be verified'
    })
    assert.equal(closed.ok, true)
    if (!closed.ok) throw new Error('a thread whose only met criterion is unverified-reasoned must still close')
    assert.deepEqual(closed.structured.result_status_split, {
      verified: 0,
      unverified_reasoned: 1,
      not_recorded: 0
    })
  })
})
