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
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Thread } from '../../src/schema/thread.ts'
import type { Decision } from '../../src/schema/decision.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

const FORMER_CRITERION_RESULT_MAX = 1000
const FORMER_CRITERION_SETTLED_BY_MAX = 500
const FORMER_RISK_TEXT_MAX = 500
const FORMER_DECISION_CONTEXT_MAX = 4000
const FORMER_DECISION_OUTCOME_MAX = 4000
const FORMER_SESSION_BODY_MAX = 8000
const FORMER_THREAD_RECORD_SERIALISED_MAX_BYTES = 65536
const FORMER_DECISION_RECORD_SERIALISED_MAX_BYTES = 65536

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`caps-relaxed fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-caps-relaxed-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Caps Relaxed Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'caps-relaxed@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook caps-relaxed fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-caps-relaxed-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-caps-relaxed-home-'))
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

const runtimeFor = (fx: Fixture): Runtime =>
  testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const callOpenThread = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'open_thread', arguments: args })) as CallToolResult

const callUpdateThread = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'update_thread', arguments: args })) as CallToolResult

const callAmendCriteria = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'amend_criteria', arguments: args })) as CallToolResult

const callRecordDecision = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'record_decision', arguments: args })) as CallToolResult

const callLogSessionEvent = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'log_session_event', arguments: args })) as CallToolResult

const openMinimalThread = async (fx: Fixture, slug: string, criteria: Record<string, unknown>[] = []): Promise<{
  threadId: string
  criterionIds: string[]
}> => {
  const opened = await callOpenThread(fx, {
    title: `${slug} thread`,
    slug,
    active_goal: `exercise the ${slug} fixture`,
    next_step: `exercise the ${slug} fixture`,
    completion_criteria: criteria
  })
  assert.equal(opened.isError, undefined, `caps-relaxed fixture: open_thread refused the ${slug} fixture: ${firstTextOf(opened)}`)
  const structured = opened.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  return { threadId: structured.thread_id, criterionIds: structured.completion_criteria.map((c) => c.id) }
}

const readThreadRecord = (fx: Fixture, threadId: string): Thread => {
  const rt = runtimeFor(fx)
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`caps-relaxed fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`caps-relaxed fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

const readDecisionRecord = (fx: Fixture, decisionId: string): Decision => {
  const rt = runtimeFor(fx)
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`caps-relaxed fixture: could not open the store to re-read a decision: ${opened.message}`)
  const slot = opened.value.readDecision(decisionId)
  if (slot === null || slot.quarantined) {
    throw new Error(`caps-relaxed fixture: decision "${decisionId}" could not be re-read from the store`)
  }
  return slot.record
}

const readSessionEntryBody = (fx: Fixture, threadId: string, entryId: string): string => {
  const rt = runtimeFor(fx)
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`caps-relaxed fixture: could not open the store to re-read a session entry: ${opened.message}`)
  const slot = opened.value.readSessionEntry(threadId, entryId)
  if (slot === null || slot.quarantined) {
    throw new Error(`caps-relaxed fixture: session entry "${entryId}" could not be re-read from the store`)
  }
  return slot.record.body
}

const VERBATIM_MARKER = 'and that is the whole of it.'
const FILLER_SENTENCE =
  'The reviewer walked every line of this change and confirmed each check ran to completion before moving to the next one. '

const buildVerbatimPayload = (length: number, lead: string): string => {
  const suffix = ` ${VERBATIM_MARKER}`
  const bodyLength = length - suffix.length
  if (bodyLength < lead.length) {
    throw new Error(`caps-relaxed fixture: requested payload length ${length} is too short for its lead and marker`)
  }
  let body = lead
  while (body.length < bodyLength) {
    body += FILLER_SENTENCE
  }
  const payload = `${body.slice(0, bodyLength)}${suffix}`
  if (payload.length !== length) {
    throw new Error(`caps-relaxed fixture: built a payload of length ${payload.length}, expected ${length}`)
  }
  assert.equal(escapeStored(payload), payload, 'caps-relaxed fixture: the verbatim payload must be plain enough that escaping is the identity')
  return payload
}

const buildLongPlainAsciiText = (length: number): string => {
  let text = ''
  while (text.length < length) {
    text += FILLER_SENTENCE
  }
  return text.slice(0, length)
}

test('caps-relaxed.criterion-result-at-former-cap-plus-one-is-accepted-verbatim', async () => {
  await withFixture(async (fx) => {
    const RESULT_PAYLOAD = buildVerbatimPayload(FORMER_CRITERION_RESULT_MAX + 1, 'This is the criterion result payload.')

    const { threadId, criterionIds } = await openMinimalThread(fx, 'criterion-result-relaxed-thread', [
      { text: 'the migration completes cleanly', check: 'the migration script exits 0', settledness: 'proposed' }
    ])
    const criterionId = criterionIds[0]
    assert.ok(criterionId !== undefined, 'caps-relaxed fixture: open_thread minted no criterion')

    const marked = await callUpdateThread(fx, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: RESULT_PAYLOAD, result_status: 'verified' }]
    })

    assert.equal(
      marked.isError,
      undefined,
      `a criterion result one character past the former ${FORMER_CRITERION_RESULT_MAX}-character cap must be accepted, got: ${marked.isError === true ? firstTextOf(marked) : 'no error'}`
    )

    const stored = readThreadRecord(fx, threadId)
    const criterion = stored.completion_criteria.find((c) => c.id === criterionId)
    assert.ok(criterion !== undefined, 'caps-relaxed fixture: the criterion vanished from the stored thread')
    assert.equal(criterion.result, RESULT_PAYLOAD, 'the stored result must equal the sent payload exactly, character for character')
    assert.ok(criterion.result?.endsWith(VERBATIM_MARKER), 'the stored result must retain the trailing marker, proving no truncation occurred')
  })
})

test('caps-relaxed.criterion-settled-by-at-former-cap-plus-one-is-accepted-verbatim-on-open-thread', async () => {
  await withFixture(async (fx) => {
    const SETTLED_BY_PAYLOAD = buildVerbatimPayload(FORMER_CRITERION_SETTLED_BY_MAX + 1, 'This is the open_thread settled_by payload.')

    const opened = await callOpenThread(fx, {
      title: 'open-thread settled_by relaxed thread',
      slug: 'open-thread-settled-by-relaxed-thread',
      active_goal: 'exercise the open_thread settled_by relaxation',
      next_step: 'exercise the open_thread settled_by relaxation',
      completion_criteria: [
        {
          text: 'the gate blocks before the turn ends',
          check: 'the stop-gate tests pass',
          settledness: 'confirmed',
          settled_by: SETTLED_BY_PAYLOAD
        }
      ]
    })

    assert.equal(
      opened.isError,
      undefined,
      `a confirmed criterion's settled_by one character past the former ${FORMER_CRITERION_SETTLED_BY_MAX}-character cap must be accepted through open_thread, got: ${opened.isError === true ? firstTextOf(opened) : 'no error'}`
    )

    const structured = opened.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
    const criterionId = structured.completion_criteria[0]?.id
    assert.ok(criterionId !== undefined, 'caps-relaxed fixture: open_thread minted no criterion')

    const stored = readThreadRecord(fx, structured.thread_id)
    const criterion = stored.completion_criteria.find((c) => c.id === criterionId)
    assert.ok(criterion !== undefined, 'caps-relaxed fixture: the criterion vanished from the stored thread')
    assert.equal(criterion.settled_by, SETTLED_BY_PAYLOAD, 'the stored settled_by must equal the sent payload exactly, character for character')
    assert.ok(criterion.settled_by?.endsWith(VERBATIM_MARKER), 'the stored settled_by must retain the trailing marker, proving no truncation occurred')
  })
})

test('caps-relaxed.criterion-settled-by-at-former-cap-plus-one-is-accepted-verbatim-on-update-thread', async () => {
  await withFixture(async (fx) => {
    const SETTLED_BY_PAYLOAD = buildVerbatimPayload(FORMER_CRITERION_SETTLED_BY_MAX + 1, 'This is the update_thread settled_by payload.')

    const { threadId, criterionIds } = await openMinimalThread(fx, 'update-thread-settled-by-relaxed-thread', [
      { text: 'the queue drains under load', check: 'the load test exits 0', settledness: 'proposed' }
    ])
    const criterionId = criterionIds[0]
    assert.ok(criterionId !== undefined, 'caps-relaxed fixture: open_thread minted no criterion')

    const settled = await callUpdateThread(fx, {
      thread_id: threadId,
      criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed', settled_by: SETTLED_BY_PAYLOAD }]
    })

    assert.equal(
      settled.isError,
      undefined,
      `a settled_by quote one character past the former ${FORMER_CRITERION_SETTLED_BY_MAX}-character cap must be accepted through update_thread, got: ${settled.isError === true ? firstTextOf(settled) : 'no error'}`
    )

    const stored = readThreadRecord(fx, threadId)
    const criterion = stored.completion_criteria.find((c) => c.id === criterionId)
    assert.ok(criterion !== undefined, 'caps-relaxed fixture: the criterion vanished from the stored thread')
    assert.equal(criterion.settled_by, SETTLED_BY_PAYLOAD, 'the stored settled_by must equal the sent payload exactly, character for character')
    assert.ok(criterion.settled_by?.endsWith(VERBATIM_MARKER), 'the stored settled_by must retain the trailing marker, proving no truncation occurred')
  })
})

test('caps-relaxed.criterion-settled-by-at-former-cap-plus-one-is-accepted-verbatim-on-amend-criteria-insert', async () => {
  await withFixture(async (fx) => {
    const SETTLED_BY_PAYLOAD = buildVerbatimPayload(FORMER_CRITERION_SETTLED_BY_MAX + 1, 'This is the amend_criteria insert settled_by payload.')

    const { threadId } = await openMinimalThread(fx, 'amend-criteria-settled-by-relaxed-thread')

    const decision = await callRecordDecision(fx, {
      thread_id: threadId,
      title: 'a criterion is added mid-thread',
      context: 'the team discovered a requirement that was not part of the original plan',
      options: ['add a criterion for it', 'leave it out of the definition of done'],
      outcome: 'add a criterion for it'
    })
    assert.equal(decision.isError, undefined, `caps-relaxed fixture: record_decision refused the amend_criteria fixture: ${firstTextOf(decision)}`)
    const decisionId = (decision.structuredContent as { decision_id: string }).decision_id

    const inserted = await callAmendCriteria(fx, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      text: 'the newly discovered requirement is satisfied',
      kind: 'detour',
      check: 'the new acceptance test passes',
      settledness: 'confirmed',
      settled_by: SETTLED_BY_PAYLOAD
    })

    assert.equal(
      inserted.isError,
      undefined,
      `a confirmed insert's settled_by one character past the former ${FORMER_CRITERION_SETTLED_BY_MAX}-character cap must be accepted through amend_criteria, got: ${inserted.isError === true ? firstTextOf(inserted) : 'no error'}`
    )
    const insertedCriterionId = (inserted.structuredContent as { criterion_id: string }).criterion_id

    const stored = readThreadRecord(fx, threadId)
    const criterion = stored.completion_criteria.find((c) => c.id === insertedCriterionId)
    assert.ok(criterion !== undefined, 'caps-relaxed fixture: the inserted criterion vanished from the stored thread')
    assert.equal(criterion.settled_by, SETTLED_BY_PAYLOAD, 'the stored settled_by must equal the sent payload exactly, character for character')
    assert.ok(criterion.settled_by?.endsWith(VERBATIM_MARKER), 'the stored settled_by must retain the trailing marker, proving no truncation occurred')
  })
})

test('caps-relaxed.risk-text-at-former-cap-plus-one-is-accepted-verbatim', async () => {
  await withFixture(async (fx) => {
    const RISK_TEXT_PAYLOAD = buildVerbatimPayload(FORMER_RISK_TEXT_MAX + 1, 'This is the risk text payload.')

    const { threadId } = await openMinimalThread(fx, 'risk-text-relaxed-thread')

    const updated = await callUpdateThread(fx, {
      thread_id: threadId,
      risks_add: [{ text: RISK_TEXT_PAYLOAD, scope: 'the area this risk concerns' }]
    })

    assert.equal(
      updated.isError,
      undefined,
      `a risk text one character past the former ${FORMER_RISK_TEXT_MAX}-character cap must be accepted, got: ${updated.isError === true ? firstTextOf(updated) : 'no error'}`
    )

    const stored = readThreadRecord(fx, threadId)
    const risk = stored.spine.open_risks[0]
    assert.ok(risk !== undefined, 'caps-relaxed fixture: the risk vanished from the stored spine')
    assert.equal(risk.text, RISK_TEXT_PAYLOAD, 'the stored risk text must equal the sent payload exactly, character for character')
    assert.ok(risk.text.endsWith(VERBATIM_MARKER), 'the stored risk text must retain the trailing marker, proving no truncation occurred')
  })
})

test('caps-relaxed.decision-context-and-outcome-at-former-cap-plus-one-are-accepted-verbatim', async () => {
  await withFixture(async (fx) => {
    const CONTEXT_PAYLOAD = buildVerbatimPayload(FORMER_DECISION_CONTEXT_MAX + 1, 'This is the decision context payload.')
    const OUTCOME_PAYLOAD = buildVerbatimPayload(FORMER_DECISION_OUTCOME_MAX + 1, 'This is the decision outcome payload.')
    assert.notEqual(CONTEXT_PAYLOAD, OUTCOME_PAYLOAD, 'caps-relaxed fixture: context and outcome payloads must differ so a swap would be caught')

    const { threadId } = await openMinimalThread(fx, 'decision-context-outcome-relaxed-thread')

    const recorded = await callRecordDecision(fx, {
      thread_id: threadId,
      title: 'a decision that needs plenty of room to explain itself',
      context: CONTEXT_PAYLOAD,
      options: ['keep the current approach', 'adopt the alternative'],
      outcome: OUTCOME_PAYLOAD
    })

    assert.equal(
      recorded.isError,
      undefined,
      `a decision context or outcome one character past its former cap must be accepted, got: ${recorded.isError === true ? firstTextOf(recorded) : 'no error'}`
    )
    const decisionId = (recorded.structuredContent as { decision_id: string }).decision_id

    const decision = readDecisionRecord(fx, decisionId)
    assert.equal(decision.context, CONTEXT_PAYLOAD, 'the stored context must equal the sent payload exactly, character for character')
    assert.ok(decision.context.endsWith(VERBATIM_MARKER), 'the stored context must retain the trailing marker, proving no truncation occurred')
    assert.equal(decision.outcome, OUTCOME_PAYLOAD, 'the stored outcome must equal the sent payload exactly, character for character')
    assert.ok(decision.outcome.endsWith(VERBATIM_MARKER), 'the stored outcome must retain the trailing marker, proving no truncation occurred')
  })
})

test('caps-relaxed.a-criterion-result-past-the-former-thread-record-byte-cap-is-accepted-and-the-thread-stays-writable', async () => {
  await withFixture(async (fx) => {
    const RESULT_PAYLOAD = buildVerbatimPayload(
      FORMER_THREAD_RECORD_SERIALISED_MAX_BYTES + 4000,
      'This is the large criterion result payload.'
    )

    const { threadId, criterionIds } = await openMinimalThread(fx, 'thread-record-past-former-cap', [
      { text: 'the large result is stored whole', check: 'the stored result equals the sent payload', settledness: 'proposed' }
    ])
    const criterionId = criterionIds[0]
    assert.ok(criterionId !== undefined, 'caps-relaxed fixture: open_thread minted no criterion')

    const marked = await callUpdateThread(fx, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: RESULT_PAYLOAD, result_status: 'verified' }]
    })
    assert.equal(
      marked.isError,
      undefined,
      `a criterion result that takes the thread record past ${FORMER_THREAD_RECORD_SERIALISED_MAX_BYTES} bytes must be accepted, got: ${marked.isError === true ? firstTextOf(marked) : 'no error'}`
    )

    const stored = readThreadRecord(fx, threadId)
    assert.ok(
      Buffer.byteLength(JSON.stringify(stored), 'utf8') > FORMER_THREAD_RECORD_SERIALISED_MAX_BYTES,
      'the stored thread record must itself be past the former byte cap'
    )
    const criterion = stored.completion_criteria.find((c) => c.id === criterionId)
    assert.ok(criterion !== undefined, 'caps-relaxed fixture: the criterion vanished from the stored thread')
    assert.equal(criterion.result, RESULT_PAYLOAD, 'the stored result must equal the sent payload exactly, character for character')

    const followUp = await callUpdateThread(fx, { thread_id: threadId, next_step: 'continue after the large result' })
    assert.equal(
      followUp.isError,
      undefined,
      `a later write to a thread past the former byte cap must be accepted, got: ${followUp.isError === true ? firstTextOf(followUp) : 'no error'}`
    )
    assert.equal(readThreadRecord(fx, threadId).spine.next_step, 'continue after the large result')
  })
})

test('caps-relaxed.a-decision-record-past-the-former-decision-record-byte-cap-is-accepted-and-linked', async () => {
  await withFixture(async (fx) => {
    const CONTEXT_PAYLOAD = buildVerbatimPayload(40000, 'This is the large decision context payload.')
    const OUTCOME_PAYLOAD = buildVerbatimPayload(40000, 'This is the large decision outcome payload.')

    const { threadId } = await openMinimalThread(fx, 'decision-record-past-former-cap')

    const recorded = await callRecordDecision(fx, {
      thread_id: threadId,
      title: 'a decision whose reasoning runs long',
      context: CONTEXT_PAYLOAD,
      options: ['keep the current approach', 'adopt the alternative'],
      outcome: OUTCOME_PAYLOAD
    })
    assert.equal(
      recorded.isError,
      undefined,
      `a decision record past ${FORMER_DECISION_RECORD_SERIALISED_MAX_BYTES} bytes must be accepted, got: ${recorded.isError === true ? firstTextOf(recorded) : 'no error'}`
    )
    const structured = recorded.structuredContent as { decision_id: string; linked: boolean }
    assert.equal(structured.linked, true, 'the decision must be linked into the running summary')

    const decision = readDecisionRecord(fx, structured.decision_id)
    assert.ok(
      Buffer.byteLength(JSON.stringify(decision), 'utf8') > FORMER_DECISION_RECORD_SERIALISED_MAX_BYTES,
      'the stored decision record must itself be past the former byte cap'
    )
    assert.equal(decision.context, CONTEXT_PAYLOAD, 'the stored context must equal the sent payload exactly')
    assert.equal(decision.outcome, OUTCOME_PAYLOAD, 'the stored outcome must equal the sent payload exactly')
  })
})

test('caps-relaxed.session-body-at-former-cap-plus-one-is-accepted-verbatim', async () => {
  await withFixture(async (fx) => {
    const BODY_PAYLOAD = buildVerbatimPayload(FORMER_SESSION_BODY_MAX + 1, 'This is the session body payload.')

    const { threadId } = await openMinimalThread(fx, 'session-body-relaxed-thread')

    const logged = await callLogSessionEvent(fx, {
      thread_id: threadId,
      actor: 'caps-relaxed-test',
      body: BODY_PAYLOAD
    })

    assert.equal(
      logged.isError,
      undefined,
      `a session body one character past the former ${FORMER_SESSION_BODY_MAX}-character cap must be accepted, got: ${logged.isError === true ? firstTextOf(logged) : 'no error'}`
    )
    const entryId = (logged.structuredContent as { session_entry_id: string }).session_entry_id

    const storedBody = readSessionEntryBody(fx, threadId, entryId)
    assert.equal(storedBody, BODY_PAYLOAD, 'the stored session body must equal the sent payload exactly, character for character')
    assert.ok(storedBody.endsWith(VERBATIM_MARKER), 'the stored session body must retain the trailing marker, proving no truncation occurred')
  })
})

test('caps-relaxed.session-body-past-32000-characters-is-refused-reporting-the-new-bound', async () => {
  await withFixture(async (fx) => {
    const OVERSIZED_BODY = buildLongPlainAsciiText(32001)

    const { threadId } = await openMinimalThread(fx, 'session-body-oversized-thread')

    const logged = await callLogSessionEvent(fx, {
      thread_id: threadId,
      actor: 'caps-relaxed-test',
      body: OVERSIZED_BODY
    })

    assert.equal(logged.isError, true, 'a session body past the new 32000-character bound must be refused')
    const text = firstTextOf(logged)
    assert.equal(text.split('\n')[0], 'field: body', `the refusal must name field body: ${text}`)
    assert.ok(text.includes('32000'), `the refusal must report the new bound of 32000: ${text}`)
  })
})
