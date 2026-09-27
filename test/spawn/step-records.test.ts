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
import { LEDGER_REF } from '../../src/store/ref.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`step-records fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-step-records-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Step Records Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'step-records@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook step-records fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-step-records-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-step-records-home-'))
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

const callTool = async (fx: Fixture, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name, arguments: args })) as CallToolResult

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const assertOk = (label: string, result: CallToolResult): Record<string, unknown> => {
  assert.notEqual(result.isError, true, `${label} refused: ${JSON.stringify(result.content)}`)
  const structured = result.structuredContent
  assert.ok(structured !== undefined, `${label} returned no structured content`)
  return structured as Record<string, unknown>
}

const assertRefusedOnRecords = (label: string, result: CallToolResult): string => {
  assert.equal(result.isError, true, `${label} must be refused, got: ${JSON.stringify(result.content)}`)
  const text = firstTextOf(result)
  assert.equal(text.split('\n')[0], 'field: next_step_records', `${label} must be refused naming next_step_records:\n${text}`)
  return text
}

const storedThreads = (fx: Fixture): string => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`step-records fixture: could not open the store: ${opened.message}`)
  return JSON.stringify(opened.value.readThreads())
}

const ledgerHead = (fx: Fixture): string => {
  const result = rawGit(fx.repo, ['rev-parse', LEDGER_REF])
  if (result.status !== 0) throw new Error(`step-records fixture: could not read the ledger head: ${result.stderr}`)
  return result.stdout.trim()
}

type OpenedThread = { threadId: string; criterionId: string }

const openThread = async (fx: Fixture, slug: string): Promise<OpenedThread> => {
  const structured = assertOk(
    `open_thread (${slug})`,
    await callTool(fx, 'open_thread', {
      title: `${slug} fixture thread`,
      slug,
      active_goal: `exercise the ${slug} fixture`,
      next_step: `exercise the ${slug} fixture`,
      next_step_records: [],
      completion_criteria: [{ text: `${slug} criterion`, check: `${slug} check`, settledness: 'proposed' }]
    })
  )
  const criteria = structured.completion_criteria as { id: string }[]
  const criterionId = criteria[0]?.id
  if (criterionId === undefined) throw new Error(`step-records fixture: ${slug} minted no criterion`)
  return { threadId: structured.thread_id as string, criterionId }
}

test('step-records.next-step-without-records-is-refused', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await openThread(fx, 'step-without-records')

    const threadsBefore = storedThreads(fx)
    const updateText = assertRefusedOnRecords(
      'update_thread with next_step and no next_step_records',
      await callTool(fx, 'update_thread', { thread_id: threadId, next_step: 'In src/config.ts, raise HTTP_TIMEOUT_MS to 5000' })
    )
    assert.match(updateText, /search_ledger/, `the update_thread refusal must name search_ledger:\n${updateText}`)
    assert.equal(storedThreads(fx), threadsBefore, 'a refused update_thread must change no stored thread')

    const parkedWithNothingWorked = assertRefusedOnRecords(
      'park_thread with next_step and no next_step_records while no thread is being worked',
      await callTool(fx, 'park_thread', { next_step: 'run the load test' })
    )
    assert.match(parkedWithNothingWorked, /search_ledger/, `the park_thread refusal must name search_ledger:\n${parkedWithNothingWorked}`)
    assert.equal(storedThreads(fx), threadsBefore, 'a refused park_thread must change no stored thread')

    assertOk('resume_thread', await callTool(fx, 'resume_thread', { thread_id: threadId }))
    const threadsWhileWorked = storedThreads(fx)
    const parkedWhileWorked = assertRefusedOnRecords(
      'park_thread with next_step and no next_step_records while a thread is being worked',
      await callTool(fx, 'park_thread', { next_step: 'run the load test' })
    )
    assert.match(parkedWhileWorked, /search_ledger/, `the park_thread refusal must name search_ledger:\n${parkedWhileWorked}`)
    assert.equal(storedThreads(fx), threadsWhileWorked, 'a refused park_thread must change no stored thread')

    const openText = assertRefusedOnRecords(
      'open_thread without next_step_records',
      await callTool(fx, 'open_thread', {
        title: 'a thread opened without its step records',
        slug: 'opened-without-records',
        active_goal: 'exercise the open_thread refusal',
        next_step: 'read the spec'
      })
    )
    assert.match(openText, /search_ledger/, `the open_thread refusal must name search_ledger:\n${openText}`)
    assert.equal(storedThreads(fx), threadsWhileWorked, 'a refused open_thread must store no thread')
  })
})

const RECORDS_WITHOUT_STEP = /next_step_records was sent without next_step/

test('step-records.records-without-a-next-step-are-refused', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await openThread(fx, 'records-without-step')
    const threadsBefore = storedThreads(fx)

    const updateText = assertRefusedOnRecords(
      'update_thread with next_step_records and no next_step',
      await callTool(fx, 'update_thread', { thread_id: threadId, next_step_records: [criterionId] })
    )
    assert.match(updateText, RECORDS_WITHOUT_STEP, `the refusal must say the list was sent without its step:\n${updateText}`)
    assert.equal(storedThreads(fx), threadsBefore, 'a refused update_thread must change no stored thread')

    assertOk('resume_thread', await callTool(fx, 'resume_thread', { thread_id: threadId }))
    const threadsWhileWorked = storedThreads(fx)
    const parkText = assertRefusedOnRecords(
      'park_thread with next_step_records and no next_step',
      await callTool(fx, 'park_thread', { next_step_records: [criterionId] })
    )
    assert.match(parkText, RECORDS_WITHOUT_STEP, `the refusal must say the list was sent without its step:\n${parkText}`)
    assert.equal(storedThreads(fx), threadsWhileWorked, 'a refused park_thread must change no stored thread')
  })
})

test('step-records.unknown-record-id-is-refused', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await openThread(fx, 'unknown-record')
    const unknownId = testRuntime().ulid()
    const threadsBefore = storedThreads(fx)
    const headBefore = ledgerHead(fx)

    const text = assertRefusedOnRecords(
      'update_thread naming a record id that matches no record',
      await callTool(fx, 'update_thread', { thread_id: threadId, next_step: 'read the gateway module', next_step_records: [unknownId] })
    )
    assert.ok(text.includes(unknownId), `the refusal must name the id that matched no record:\n${text}`)
    assert.equal(storedThreads(fx), threadsBefore, 'a refused update_thread must change no stored thread')
    assert.equal(ledgerHead(fx), headBefore, 'a refused update_thread must write nothing to the ledger')
  })
})

const GOVERNED_PATH = 'src/config.ts'

const TIMEOUT_DECISION = {
  title: `Keep the gateway timeout in ${GOVERNED_PATH} at or below three seconds`,
  context: 'The gateway returned 502 whenever an upstream call outlived the load balancer idle window',
  options: ['raise the timeout to five seconds', 'keep the timeout at three seconds and retry once'],
  outcome: 'keep the timeout at three seconds and retry once'
}

test('step-records.reply-shows-named-records-in-full-across-threads', async () => {
  await withFixture(async (fx) => {
    const incident = await openThread(fx, 'gateway-incident')
    const decision = assertOk(
      'record_decision on the incident thread',
      await callTool(fx, 'record_decision', { thread_id: incident.threadId, ...TIMEOUT_DECISION })
    )
    const decisionId = decision.decision_id as string
    assertOk(
      'update_thread marking the incident criterion done',
      await callTool(fx, 'update_thread', {
        thread_id: incident.threadId,
        criteria_done: [{ criterion_id: incident.criterionId, result: 'the gateway served 0 errors for a day', result_status: 'verified' }]
      })
    )
    assertOk(
      'close_thread on the incident thread',
      await callTool(fx, 'close_thread', { thread_id: incident.threadId, outcome: 'done', detail: 'the incident is resolved' })
    )

    const retry = await openThread(fx, 'retry-policy')
    const named = assertOk(
      'update_thread naming the decision on the closed thread',
      await callTool(fx, 'update_thread', {
        thread_id: retry.threadId,
        next_step: 'Raise the retry budget for upstream calls',
        next_step_records: [decisionId]
      })
    )
    const namedRecords = named.step_records
    assert.equal(typeof namedRecords, 'string', `the reply must carry step_records, got ${JSON.stringify(named)}`)
    for (const part of [TIMEOUT_DECISION.title, TIMEOUT_DECISION.context, ...TIMEOUT_DECISION.options, TIMEOUT_DECISION.outcome]) {
      assert.ok((namedRecords as string).includes(part), `step_records must show the decision in full, missing ${JSON.stringify(part)}:\n${namedRecords as string}`)
    }
    assert.ok((namedRecords as string).includes(decisionId), `step_records must name the decision id:\n${namedRecords as string}`)

    const matched = assertOk(
      'update_thread whose next step names a governed path',
      await callTool(fx, 'update_thread', {
        thread_id: retry.threadId,
        next_step: `In ${GOVERNED_PATH}, add a retry budget beside the gateway timeout`,
        next_step_records: []
      })
    )
    const matchedRecords = matched.step_records as string
    const label = `Matched by file name, because this step names ${GOVERNED_PATH}:`
    const labelAt = matchedRecords.indexOf(label)
    assert.notEqual(labelAt, -1, `step_records must label the records matched by file name:\n${matchedRecords}`)
    assert.ok(
      matchedRecords.indexOf(TIMEOUT_DECISION.title, labelAt) > labelAt,
      `the live decision naming ${GOVERNED_PATH} must appear under the file-name label:\n${matchedRecords}`
    )
    assert.ok(
      matchedRecords.indexOf(TIMEOUT_DECISION.outcome, labelAt) > labelAt,
      `the matched decision must appear in full:\n${matchedRecords}`
    )
  })
})

test('step-records.park-refuses-landed', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await openThread(fx, 'park-landed')
    assertOk('resume_thread', await callTool(fx, 'resume_thread', { thread_id: threadId }))
    const threadsBefore = storedThreads(fx)

    const refused = await callTool(fx, 'park_thread', {
      next_step: 'run the load test',
      next_step_records: [],
      landed: 'the load test harness is in place'
    })
    assert.equal(refused.isError, true, `park_thread must refuse landed as an unknown argument, got: ${JSON.stringify(refused.content)}`)
    assert.equal(firstTextOf(refused).split('\n')[0], 'field: landed', `the refusal must name landed:\n${firstTextOf(refused)}`)
    assert.equal(storedThreads(fx), threadsBefore, 'a refused park_thread must change no stored thread')
  })
})
