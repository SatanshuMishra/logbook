import test from 'node:test'
import assert from 'node:assert/strict'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolReply } from '../../src/server/register.ts'
import { TOOL_SPECS } from '../../src/server/tools/index.ts'
import { openStore } from '../../src/store/records.ts'
import {
  indexRecords,
  matchByFileName,
  resolveRecordIds,
  searchRecords,
  type IndexedRecord
} from '../../src/domain/record-index.ts'
import {
  renderRecordFull,
  renderRecordHeadline,
  renderRecordsInFull,
  renderSearch
} from '../../src/render/briefing.ts'
import { STUB_TOOL_CTX, withCriterionFixture } from '../support/criterion-fixture.ts'

type Structured = Record<string, unknown>

const halt = (detail: string): never => {
  throw new Error(`record-index fixture: ${detail}`)
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

const onlyIdOf = (structured: Structured, key: string): string => {
  const value = structured[key]
  if (!Array.isArray(value) || value.length !== 1) return halt(`the reply carries no single-entry ${key}`)
  const [first] = value as unknown[]
  if (typeof first === 'string') return first
  if (typeof first === 'object' && first !== null && typeof (first as Structured).id === 'string') {
    return (first as Structured).id as string
  }
  return halt(`the ${key} entry carries no id`)
}

type ThreadIds = {
  threadId: string
  slug: string
  criterionId: string
  decisionId: string
  riskId: string
  artifactId: string
  noteId: string
  entryId: string
}

const openThread = async (rt: Runtime, slug: string, criterion: Structured): Promise<{ threadId: string; criterionId: string }> => {
  const opened = await callTool(rt, 'open_thread', {
    title: `the ${slug} thread`,
    slug,
    active_goal: `keep the ${slug} work honest`,
    next_step: 'read the gateway module',
    next_step_records: [],
    completion_criteria: [criterion]
  })
  return { threadId: textOf(opened, 'thread_id'), criterionId: onlyIdOf(opened, 'completion_criteria') }
}

const recordDecision = async (rt: Runtime, threadId: string, fields: Structured): Promise<string> =>
  textOf(await callTool(rt, 'record_decision', { thread_id: threadId, options: [], ...fields }), 'decision_id')

const addRisk = async (rt: Runtime, threadId: string, risk: Structured): Promise<string> =>
  onlyIdOf(await callTool(rt, 'update_thread', { thread_id: threadId, risks_add: [risk] }), 'risks_added')

const logEntry = async (rt: Runtime, threadId: string, body: string): Promise<string> =>
  textOf(await callTool(rt, 'log_session_event', { thread_id: threadId, actor: 'claude', body }), 'session_entry_id')

const closeAsDone = async (rt: Runtime, threadId: string, criterionId: string): Promise<void> => {
  await callTool(rt, 'update_thread', {
    thread_id: threadId,
    criteria_done: [{ criterion_id: criterionId, result: 'the gateway suite passed', result_status: 'verified' }]
  })
  await callTool(rt, 'close_thread', { thread_id: threadId, outcome: 'done', detail: 'the gateway work shipped' })
}

const seedThreadWithEveryKind = async (rt: Runtime, slug: string): Promise<ThreadIds> => {
  const { threadId, criterionId } = await openThread(rt, slug, {
    text: `the ${slug} gateway answers within its deadline`,
    check: 'npm test exits 0',
    settledness: 'proposed'
  })
  const decisionId = await recordDecision(rt, threadId, {
    title: `pick the ${slug} gateway deadline`,
    context: `the ${slug} gateway waits on an upstream`,
    options: ['wait longer', 'fail fast'],
    outcome: 'fail fast so callers can retry'
  })
  const riskId = await addRisk(rt, threadId, {
    text: `the ${slug} upstream may stall`,
    scope: 'gateway',
    criterion_id: null
  })
  const extras = await callTool(rt, 'update_thread', {
    thread_id: threadId,
    out_of_scope_add: [`rewriting the ${slug} upstream`],
    artifacts_add: [{ label: `${slug} gateway notes`, pointer: `docs/${slug}.md` }]
  })
  const entryId = await logEntry(rt, threadId, `measured the ${slug} gateway latency`)
  return {
    threadId,
    slug,
    criterionId,
    decisionId,
    riskId,
    artifactId: onlyIdOf(extras, 'artifacts_added'),
    noteId: onlyIdOf(extras, 'out_of_scope_added'),
    entryId
  }
}

const indexOf = (rt: Runtime): IndexedRecord[] => {
  const opened = openStore(rt, rt.cwd)
  return opened.ok ? indexRecords(opened.value) : halt(`the store did not open: ${opened.message}`)
}

const identities = (records: readonly IndexedRecord[]): { id: string; kind: string; threadSlug: string }[] =>
  records.map((record) => ({ id: record.id, kind: record.kind, threadSlug: record.threadSlug }))

const recordNamed = (index: readonly IndexedRecord[], id: string): IndexedRecord =>
  index.find((record) => record.id === id) ?? halt(`no indexed record carries id ${id}`)

test('record-index.resolves-any-record-by-id-across-threads', async () => {
  await withCriterionFixture(async (rt) => {
    const open = await seedThreadWithEveryKind(rt, 'open-gateway')
    const closed = await seedThreadWithEveryKind(rt, 'closed-gateway')
    await closeAsDone(rt, closed.threadId, closed.criterionId)
    const unknownId = rt.ulid()

    const expected = [open, closed].flatMap((thread) => [
      { id: thread.decisionId, kind: 'decision', threadSlug: thread.slug },
      { id: thread.riskId, kind: 'risk', threadSlug: thread.slug },
      { id: thread.criterionId, kind: 'criterion', threadSlug: thread.slug },
      { id: thread.entryId, kind: 'entry', threadSlug: thread.slug },
      { id: thread.artifactId, kind: 'artifact', threadSlug: thread.slug },
      { id: thread.noteId, kind: 'out-of-scope', threadSlug: thread.slug }
    ])
    const requested = [...expected.map((entry) => entry.id), unknownId, open.decisionId, unknownId]

    const resolved = resolveRecordIds(indexOf(rt), requested)

    assert.deepEqual(identities(resolved.found), expected)
    assert.deepEqual(resolved.missing, [unknownId])
    assert.deepEqual(
      resolved.found.filter((record) => record.threadSlug === closed.slug).map((record) => record.threadStatus),
      Array.from({ length: 6 }, () => 'done')
    )
  })
})

test('record-index.file-name-match-adds-live-decisions-and-risks-naming-a-step-path', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionId } = await openThread(rt, 'timeout-ruling', {
      text: 'the gateway timeout is ruled on',
      check: 'npm test exits 0',
      settledness: 'proposed'
    })
    const supersededId = await recordDecision(rt, threadId, {
      title: 'Keep HTTP_TIMEOUT_MS in src/config.ts at 5000',
      context: 'the first ruling on src/config.ts',
      outcome: 'keep it at 5000'
    })
    const outcome = 'keep the timeout at or below 3000 so the gateway never waits past its own deadline'
    const liveId = await recordDecision(rt, threadId, {
      title: 'Keep HTTP_TIMEOUT_MS at or below 3000',
      context: 'the gateway deadline is 3000 ms, and HTTP_TIMEOUT_MS lives in src/config.ts',
      outcome,
      supersedes: [supersededId]
    })
    const retiredRiskId = await addRisk(rt, threadId, {
      text: 'raising the timeout in src/config.ts may stall callers',
      scope: 'gateway',
      criterion_id: null
    })
    await callTool(rt, 'update_thread', { thread_id: threadId, risks_retire: [retiredRiskId] })
    const entryId = await logEntry(rt, threadId, 'read src/config.ts to find the timeout')
    await closeAsDone(rt, threadId, criterionId)
    const stepText = 'In src/config.ts, raise the timeout'
    const index = indexOf(rt)
    const namingThePath = [supersededId, liveId, retiredRiskId, entryId].map((id) => recordNamed(index, id))
    assert.ok(
      namingThePath.every((record) => record.fields.some((field) => field.includes('src/config.ts'))),
      'every seeded record must name src/config.ts, or leaving it out proves nothing'
    )

    const matches = matchByFileName(index, stepText, new Set())

    assert.deepEqual(
      matches.map((match) => ({ path: match.path, id: match.record.id })),
      [{ path: 'src/config.ts', id: liveId }]
    )
    assert.deepEqual(matchByFileName(index, stepText, new Set([liveId])), [])
    const rendered = renderRecordsInFull([], matches)
    assert.ok(rendered.startsWith('This step names no records.'), rendered)
    assert.ok(rendered.includes('Matched by file name, because this step names src/config.ts:'), rendered)
    assert.ok(rendered.includes(outcome), rendered)
  })
})

test('record-index.search-lists-every-thread-and-says-a-miss-proves-nothing', async () => {
  await withCriterionFixture(async (rt) => {
    const open = await openThread(rt, 'retry-timeouts', {
      text: 'retries respect the timeout',
      check: 'npm test exits 0',
      settledness: 'proposed'
    })
    const openRiskId = await addRisk(rt, open.threadId, {
      text: 'a retry may outlive the timeout',
      scope: 'retry',
      criterion_id: null
    })
    const closed = await openThread(rt, 'gateway-timeouts', {
      text: 'the gateway honours its deadline',
      check: 'npm test exits 0',
      settledness: 'proposed'
    })
    const supersededId = await recordDecision(rt, closed.threadId, {
      title: 'Leave the gateway timeout alone',
      context: 'nobody had measured the timeout yet',
      outcome: 'leave it'
    })
    const replacementId = await recordDecision(rt, closed.threadId, {
      title: 'Lower the gateway deadline',
      context: 'callers asked us to raise the\ntimeout, but the upstream deadline forbids it',
      outcome: 'lower it to 3000',
      supersedes: [supersededId]
    })
    await closeAsDone(rt, closed.threadId, closed.criterionId)
    const index = indexOf(rt)

    const live = searchRecords(index, { text: 'timeout' })
    const liveListing = renderSearch(live)

    assert.deepEqual(
      [...new Set(live.records.map((record) => record.threadSlug))].sort(),
      ['gateway-timeouts', 'retry-timeouts']
    )
    assert.ok(live.records.some((record) => record.id === openRiskId))
    assert.ok(liveListing.includes(`${openRiskId} [retry-timeouts, open]`), liveListing)
    assert.ok(liveListing.includes(`${replacementId} [gateway-timeouts, done]`), liveListing)
    assert.equal(live.missProvesNothing, true)
    assert.ok(liveListing.includes('finding nothing proves nothing'), liveListing)
    assert.equal(live.records.some((record) => record.id === supersededId), false)

    const spanning = searchRecords(index, { text: 'raise the timeout' })
    assert.deepEqual(
      spanning.records.map((record) => record.id),
      [replacementId]
    )

    const everything = searchRecords(index, { text: 'timeout', status: 'all' })
    assert.ok(everything.records.some((record) => record.id === supersededId))
    assert.ok(renderSearch(everything).includes(`(superseded by ${replacementId})`), renderSearch(everything))
  })
})

test('record-index.renders-criteria-with-settledness-and-risks-with-their-anchor', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionId } = await openThread(rt, 'settled-gateway', {
      text: 'the gateway answers within its deadline',
      check: 'npm test exits 0',
      settledness: 'confirmed',
      settled_by: 'the human confirmed it'
    })
    const anchoredRiskId = await addRisk(rt, threadId, {
      text: 'the deadline may be too tight',
      scope: 'gateway',
      criterion_id: criterionId
    })
    const wholeThreadRiskId = await addRisk(rt, threadId, {
      text: 'the upstream may be retired',
      scope: 'gateway',
      criterion_id: null
    })
    const index = indexOf(rt)
    const criterion = recordNamed(index, criterionId)
    const anchoredRisk = recordNamed(index, anchoredRiskId)
    const wholeThreadRisk = recordNamed(index, wholeThreadRiskId)

    const criterionFull = renderRecordFull(criterion)
    assert.ok(criterionFull.includes('confirmed'), criterionFull)
    assert.ok(criterionFull.includes('Settled by: the human confirmed it'), criterionFull)
    assert.ok(renderRecordHeadline(criterion).startsWith('c1 [open] [confirmed]'), renderRecordHeadline(criterion))

    assert.ok(renderRecordFull(anchoredRisk).includes(`Bears on: criterion ${criterionId}`), renderRecordFull(anchoredRisk))
    assert.ok(
      renderRecordHeadline(anchoredRisk).endsWith(`(bears on criterion ${criterionId})`),
      renderRecordHeadline(anchoredRisk)
    )
    assert.ok(renderRecordFull(wholeThreadRisk).includes('Bears on: the whole thread'), renderRecordFull(wholeThreadRisk))
  })
})
