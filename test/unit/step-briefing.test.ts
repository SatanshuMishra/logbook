import test from 'node:test'
import assert from 'node:assert/strict'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolReply } from '../../src/server/register.ts'
import { TOOL_SPECS } from '../../src/server/tools/index.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import type { Spine, Thread } from '../../src/schema/thread.ts'
import { renderStepBriefing } from '../../src/render/briefing.ts'
import { STUB_TOOL_CTX, withCriterionFixture } from '../support/criterion-fixture.ts'

type Structured = Record<string, unknown>

const WHAT_THIS_STEP_NEEDS = '**What this step needs:**'
const OTHER_RECORDS_HEADING_START = '**Other records on this thread**'
const SESSION_LOG_LABEL = '**Session log:**'
const OTHER_THREADS_LINE =
  '**Other threads:** search_ledger lists and searches the records on every thread, closed ones included.'
const LONG_OUTCOME_MIN_CHARS = 40_000

const halt = (detail: string): never => {
  throw new Error(`step-briefing fixture: ${detail}`)
}

const callTool = async (rt: Runtime, name: string, input: Structured): Promise<Structured> => {
  const spec = TOOL_SPECS.find((candidate) => candidate.name === name) ?? halt(`no tool is named ${name}`)
  const reply: ToolReply<Structured> = await spec.handler(rt, STUB_TOOL_CTX, spec.input.parse(input) as never)
  return reply.ok ? reply.structured : halt(`${name} refused: ${reply.refusal.message}`)
}

const textOf = (structured: Structured, key: string): string => {
  const value = structured[key]
  return typeof value === 'string' ? value : halt(`the reply carries no string ${key}`)
}

const idsOf = (structured: Structured, key: string): string[] => {
  const value = structured[key]
  if (!Array.isArray(value)) return halt(`the reply carries no list ${key}`)
  return value.map((entry: unknown) => {
    if (typeof entry === 'string') return entry
    if (typeof entry === 'object' && entry !== null && typeof (entry as Structured).id === 'string') {
      return (entry as Structured).id as string
    }
    return halt(`an entry of ${key} carries no id`)
  })
}

const onlyIdOf = (structured: Structured, key: string): string => {
  const ids = idsOf(structured, key)
  const [only] = ids
  return ids.length === 1 && only !== undefined ? only : halt(`the reply carries ${ids.length} entries in ${key}, not one`)
}

type OpenedThread = { threadId: string; slug: string; criterionIds: string[] }

const openThread = async (rt: Runtime, slug: string, criteria: Structured[]): Promise<OpenedThread> => {
  const opened = await callTool(rt, 'open_thread', {
    title: `the ${slug} thread`,
    slug,
    active_goal: `keep the ${slug} work honest`,
    next_step: 'read the gateway module',
    next_step_records: [],
    completion_criteria: criteria
  })
  return { threadId: textOf(opened, 'thread_id'), slug, criterionIds: idsOf(opened, 'completion_criteria') }
}

const recordDecision = async (rt: Runtime, threadId: string, fields: Structured): Promise<string> =>
  textOf(await callTool(rt, 'record_decision', { thread_id: threadId, options: [], ...fields }), 'decision_id')

const addRisk = async (rt: Runtime, threadId: string, risk: Structured): Promise<string> =>
  onlyIdOf(await callTool(rt, 'update_thread', { thread_id: threadId, risks_add: [risk] }), 'risks_added')

const logEntry = async (rt: Runtime, threadId: string, body: string): Promise<string> =>
  textOf(await callTool(rt, 'log_session_event', { thread_id: threadId, actor: 'claude', body }), 'session_entry_id')

const setNextStep = async (rt: Runtime, threadId: string, nextStep: string, records: string[]): Promise<void> => {
  await callTool(rt, 'update_thread', { thread_id: threadId, next_step: nextStep, next_step_records: records })
}

const storeOf = (rt: Runtime): Store => {
  const opened = openStore(rt, rt.cwd)
  return opened.ok ? opened.value : halt(`the store did not open: ${opened.message}`)
}

const threadIn = (store: Store, threadId: string): Thread => {
  const slot = store.readThread(threadId) ?? halt(`no thread ${threadId} is stored`)
  return slot.quarantined ? halt(`thread ${threadId} is quarantined`) : slot.record
}

const seedSpine = (rt: Runtime, threadId: string, spineOf: (spine: Spine) => Spine): void => {
  const store = storeOf(rt)
  const thread = threadIn(store, threadId)
  const committed = store.commit([{ kind: 'thread', record: { ...thread, spine: spineOf(thread.spine) } }], 'test: seed the spine')
  if (!committed.ok) halt(`seeding the spine did not commit: ${committed.detail}`)
}

const briefingOf = (rt: Runtime, threadId: string): string => {
  const store = storeOf(rt)
  return renderStepBriefing(store, threadIn(store, threadId), null, { resolved: 0, dangling: [], quarantined: [] }, 0)
}

const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start)
  const to = text.indexOf(end, from + start.length)
  if (from === -1 || to === -1) return halt(`the briefing carries no section from ${start} to ${end}`)
  return text.slice(from + start.length, to)
}

const stepNeedsSection = (briefing: string): string => between(briefing, WHAT_THIS_STEP_NEEDS, OTHER_RECORDS_HEADING_START)

const otherRecordLines = (briefing: string): string[] =>
  between(briefing, OTHER_RECORDS_HEADING_START, SESSION_LOG_LABEL)
    .split('\n')
    .filter((line) => line.startsWith('- '))

test('briefing.shows-the-goal-the-next-step-and-its-records-in-full', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openThread(rt, 'retry-jitter', [])
    const namedOutcome = 'set RETRY_JITTER_MAX_MS = 750 so retries spread across the window'
    const namedId = await recordDecision(rt, threadId, {
      title: 'Cap the retry jitter',
      context: 'retries from every caller landed on the gateway in the same millisecond',
      options: ['no jitter', 'full jitter capped at 750 ms'],
      outcome: namedOutcome
    })
    const matchedOutcome = 'double the delay on each attempt and never wait longer than 8 seconds'
    await recordDecision(rt, threadId, {
      title: 'Keep the backoff table where it is',
      context: 'the backoff table lives in src/retry/policy.ts',
      outcome: matchedOutcome
    })
    const nextStep = 'Apply the jitter policy in src/retry/policy.ts'
    await setNextStep(rt, threadId, nextStep, [namedId])

    const briefing = briefingOf(rt, threadId)
    const needs = stepNeedsSection(briefing)

    assert.ok(briefing.includes('**Goal:**\n\n> keep the retry-jitter work honest\n'), briefing)
    assert.ok(briefing.includes(`**Next step:**\n\n> ${nextStep}\n`), briefing)
    assert.ok(needs.includes(`Decision ${namedId} `), `the named decision must be shown in full:\n${needs}`)
    assert.ok(needs.includes(`Outcome: ${namedOutcome}`), `the named decision's outcome must be shown:\n${needs}`)
    assert.ok(
      needs.includes('Matched by file name, because this step names src/retry/policy.ts:'),
      `the matched decision must sit under a label naming the path:\n${needs}`
    )
    assert.ok(needs.includes(`Outcome: ${matchedOutcome}`), `the matched decision's outcome must be shown:\n${needs}`)
  })
})

test('briefing.lists-other-live-thread-records-one-line-each', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openThread(rt, 'gateway-limits', [
      { text: 'the gateway answers within its deadline', check: 'npm test exits 0', settledness: 'proposed' },
      { text: 'the retry budget is documented', settledness: 'unsettled' }
    ])
    const [firstCriterionId, secondCriterionId] = criterionIds
    if (firstCriterionId === undefined || secondCriterionId === undefined) return halt('open_thread minted fewer than two criteria')
    const namedId = await recordDecision(rt, threadId, { title: 'Fail fast on a stalled upstream', context: 'c', outcome: 'fail fast' })
    const otherDecisionId = await recordDecision(rt, threadId, {
      title: 'Keep one gateway process per host',
      context: 'c',
      outcome: 'one process'
    })
    const anchoredRiskId = await addRisk(rt, threadId, {
      text: 'the upstream may stall past the deadline',
      scope: 'gateway',
      criterion_id: firstCriterionId
    })
    const wholeThreadRiskId = await addRisk(rt, threadId, {
      text: 'the host may run out of sockets',
      scope: 'gateway',
      criterion_id: null
    })
    const retiredRiskId = await addRisk(rt, threadId, { text: 'a retired worry', scope: 'gateway', criterion_id: null })
    await callTool(rt, 'update_thread', { thread_id: threadId, risks_retire: [retiredRiskId] })
    const extras = await callTool(rt, 'update_thread', {
      thread_id: threadId,
      out_of_scope_add: ['rewriting the upstream'],
      artifacts_add: [{ label: 'gateway notes', pointer: 'docs/gateway.md' }]
    })
    const artifactId = onlyIdOf(extras, 'artifacts_added')
    const noteId = onlyIdOf(extras, 'out_of_scope_added')
    await logEntry(rt, threadId, 'measured the gateway latency')
    await setNextStep(rt, threadId, 'decide the stall timeout', [namedId])

    const lines = otherRecordLines(briefingOf(rt, threadId))

    assert.deepEqual(lines, [
      `- decision ${otherDecisionId}: Keep one gateway process per host`,
      `- risk ${anchoredRiskId}: the upstream may stall past the deadline (bears on criterion ${firstCriterionId})`,
      `- risk ${wholeThreadRiskId}: the host may run out of sockets (bears on the whole thread)`,
      `- criterion ${firstCriterionId}: c1 [open] [proposed] the gateway answers within its deadline`,
      `- criterion ${secondCriterionId}: c2 [open] [unsettled] the retry budget is documented`,
      `- artifact ${artifactId}: gateway notes -> docs/gateway.md`,
      `- out-of-scope ${noteId}: rewriting the upstream`
    ])
    assert.equal(lines.some((line) => line.includes(retiredRiskId)), false, 'a retired risk must not be listed')
    assert.equal(lines.some((line) => line.includes(namedId)), false, 'a record shown in full must not be listed again')
  })
})

test('briefing.counts-the-session-log-and-points-to-search', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openThread(rt, 'session-count', [])
    await logEntry(rt, threadId, 'read the gateway module')
    await logEntry(rt, threadId, 'measured the gateway latency')
    await logEntry(rt, threadId, 'wrote the stall test')

    const briefing = briefingOf(rt, threadId)

    assert.ok(briefing.includes(`**Session log:** 3 entries at logbook://sessions/${threadId}`), briefing)
    assert.ok(briefing.includes(OTHER_THREADS_LINE), briefing)
  })
})

test('briefing.shows-no-landed-and-cuts-nothing', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openThread(rt, 'long-outcome', [])
    const clause = 'every retry waits for the jitter window before it calls the gateway again '
    const outcome = `${clause.repeat(Math.ceil(LONG_OUTCOME_MIN_CHARS / clause.length))}and this is the final clause`
    assert.ok(outcome.length > LONG_OUTCOME_MIN_CHARS, 'the outcome must be longer than 40,000 characters')
    const decisionId = await recordDecision(rt, threadId, { title: 'Spread every retry', context: 'c', outcome })
    await setNextStep(rt, threadId, 'apply the retry ruling', [decisionId])
    const landed = 'landed the retry spreading and verified it against the gateway suite'
    seedSpine(rt, threadId, (spine) => ({ ...spine, landed }))

    const briefing = briefingOf(rt, threadId)

    assert.equal(briefing.includes('Landed'), false, 'the briefing must carry no Landed heading')
    assert.equal(briefing.includes(landed), false, 'the stored landed text must not be shown')
    assert.ok(stepNeedsSection(briefing).includes(`Outcome: ${outcome}\n`), 'the whole outcome must be shown')
    assert.equal(briefing.includes('shortened'), false, 'the briefing must carry no shortened notice')
  })
})

test('briefing.reads-a-stored-next-step-criterion-as-named', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openThread(rt, 'old-anchor', [
      { text: 'the stall timeout is ruled on', check: 'the ruling names a number', settledness: 'proposed' }
    ])
    const [criterionId] = criterionIds
    if (criterionId === undefined) return halt('open_thread minted no criterion')
    seedSpine(rt, threadId, ({ next_step_records: _dropped, ...spine }) => ({ ...spine, next_step_criterion_id: criterionId }))

    const briefing = briefingOf(rt, threadId)
    const needs = stepNeedsSection(briefing)

    assert.equal(threadIn(storeOf(rt), threadId).spine.next_step_records, undefined, 'the seeded spine must carry no list')
    assert.ok(needs.includes(`Criterion ${criterionId} `), `the stored criterion must be shown in full:\n${needs}`)
    assert.ok(needs.includes('Check: the ruling names a number'), `the criterion's check must be shown:\n${needs}`)
    assert.equal(
      otherRecordLines(briefing).some((line) => line.includes(criterionId)),
      false,
      'a criterion shown in full must not be listed again'
    )
  })
})

test('briefing.reports-records-it-could-not-read', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openThread(rt, 'unreadable', [
      { text: 'the gateway retries are ruled on', check: 'the ruling names a count', settledness: 'proposed' }
    ])
    const missingId = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
    const danglingId = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
    const quarantinedId = '01ARZ3NDEKTSV4RRFFQ69G5FAX'
    seedSpine(rt, threadId, (spine) => ({ ...spine, next_step_records: [missingId] }))

    const store = storeOf(rt)
    const briefing = renderStepBriefing(
      store,
      threadIn(store, threadId),
      null,
      { resolved: 0, dangling: [danglingId], quarantined: [quarantinedId] },
      2
    )
    const needs = stepNeedsSection(briefing)

    assert.ok(
      needs.includes(`Named by this step but not readable now: ${missingId}`),
      `a named record that cannot be read must be named, not dropped:\n${needs}`
    )
    assert.ok(briefing.includes('**Unreadable records:**'), `the briefing must report unreadable records:\n${briefing}`)
    assert.ok(briefing.includes('- 2 linked decision records could not be read'), `the unreadable decisions must be counted:\n${briefing}`)
    assert.ok(briefing.includes(`- dangling: ${danglingId}`), `a dangling decision must be named:\n${briefing}`)
    assert.ok(briefing.includes(`- quarantined: ${quarantinedId}`), `a quarantined decision must be named:\n${briefing}`)
    assert.ok(
      briefing.includes('- 2 session log entries on this thread could not be read'),
      `the unreadable session entries must be counted:\n${briefing}`
    )
    assert.equal(briefingOf(rt, threadId).includes('**Unreadable records:**'), false, 'a thread with nothing unreadable shows no such section')
  })
})
