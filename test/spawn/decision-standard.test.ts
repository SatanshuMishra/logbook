import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { LEDGER_REF } from '../../src/store/ref.ts'
import { rawGit } from '../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = path.join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = { spawned: SpawnedServer; repo: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`decision-standard fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapCommittedRepo = (): string => {
  const repo = mkdtempSync(path.join(tmpdir(), 'logbook-decision-standard-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Decision Standard Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'decision-standard-fixture@logbook.test'])
  writeFileSync(path.join(repo, 'README.md'), 'logbook decision-standard fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapCommittedRepo()
  const pluginDataHome = mkdtempSync(path.join(tmpdir(), 'logbook-decision-standard-plugin-data-'))
  const pluginData = path.join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await fn({ spawned, repo })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}

const call = async (fx: Fixture, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name, arguments: args })) as CallToolResult

const callOk = async (fx: Fixture, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const result = await call(fx, name, args)
  assert.notEqual(result.isError, true, `${name} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
  assert.ok(isRecord(result.structuredContent), `${name} returned no structured content`)
  return result.structuredContent
}

const stringOf = (structured: Record<string, unknown>, key: string): string => {
  const value = structured[key]
  assert.equal(typeof value, 'string', `expected structured.${key} to be a string`)
  return value as string
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const openFixtureThread = async (fx: Fixture, slug: string): Promise<string> =>
  stringOf(
    await callOk(fx, 'open_thread', {
      title: `${slug} fixture`,
      slug,
      active_goal: 'settle how payment retries behave',
      next_step: 'read the payment client',
      next_step_records: []
    }),
    'thread_id'
  )

const ledgerHead = (repo: string): string => rawGit(repo, ['rev-parse', LEDGER_REF]).stdout.trim()

const storedDecision = (repo: string, decisionId: string): Record<string, unknown> => {
  const shown = rawGit(repo, ['show', `${LEDGER_REF}:decisions/${decisionId}.json`])
  assert.equal(shown.status, 0, `expected decision ${decisionId} in the ledger: ${shown.stderr}`)
  const parsed: unknown = JSON.parse(shown.stdout)
  assert.ok(isRecord(parsed), 'expected the stored decision to be a JSON object')
  return parsed
}

const decisionArgs = (threadId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  thread_id: threadId,
  title: 'Where payment retries live',
  context: 'a timeout during a charge left customers charged twice',
  options: ['retry in the client', 'retry inside charge()'],
  outcome: 'retry inside charge(), because only charges are idempotent',
  ...overrides
})

const assertRefusedNaming = async (
  fx: Fixture,
  threadId: string,
  overrides: Record<string, unknown>,
  field: string
): Promise<void> => {
  const before = ledgerHead(fx.repo)
  const result = await call(fx, 'record_decision', decisionArgs(threadId, overrides))
  const label = JSON.stringify(overrides)
  assert.equal(result.isError, true, `record_decision must refuse ${label}`)
  const text = firstTextOf(result)
  assert.equal(text.split('\n')[0], `field: ${field}`, `the refusal of ${label} must name ${field}, got:\n${text}`)
  assert.match(text, /^accepted: /m, `the refusal of ${label} is missing the accepted part`)
  assert.match(text, /^example: /m, `the refusal of ${label} is missing the example part`)
  assert.match(text, /^retryable: true/m, `the refusal of ${label} must be retryable`)
  assert.equal(ledgerHead(fx.repo), before, `a refused ${label} must not move the ledger ref`)
}

const readResourceText = async (fx: Fixture, uri: string): Promise<string> => {
  const read = await fx.spawned.client.readResource({ uri })
  const [first] = read.contents
  assert.ok(first !== undefined && 'text' in first && typeof first.text === 'string', `expected ${uri} to return text`)
  return first.text
}

const fullBriefingNaming = async (fx: Fixture, threadId: string, decisionId: string): Promise<string> => {
  await callOk(fx, 'update_thread', {
    thread_id: threadId,
    next_step: 'apply the retry ruling in the payment client',
    next_step_records: [decisionId]
  })
  const resumed = await callOk(fx, 'resume_thread', { thread_id: threadId, full_briefing: true })
  return stringOf(resumed, 'briefing')
}

test('decision-standard.refuses-an-empty-context-or-outcome', async () => {
  await withFixture(async (fx) => {
    const threadId = await openFixtureThread(fx, 'empty-context-or-outcome')
    await assertRefusedNaming(fx, threadId, { context: '' }, 'context')
    await assertRefusedNaming(fx, threadId, { context: '  ' }, 'context')
    await assertRefusedNaming(fx, threadId, { outcome: '' }, 'outcome')
    await assertRefusedNaming(fx, threadId, { outcome: '  ' }, 'outcome')
  })
})

test('decision-standard.refuses-fewer-than-two-options', async () => {
  await withFixture(async (fx) => {
    const threadId = await openFixtureThread(fx, 'fewer-than-two-options')
    await assertRefusedNaming(fx, threadId, { options: [] }, 'options')
    await assertRefusedNaming(fx, threadId, { options: ['retry in the client'] }, 'options')
    await assertRefusedNaming(fx, threadId, { options: ['retry in the client', '   '] }, 'options')
  })
})

test('decision-standard.stores-a-reason-for-each-option', async () => {
  await withFixture(async (fx) => {
    const threadId = await openFixtureThread(fx, 'a-reason-for-each-option')
    const options = ['retry in the client', 'retry inside charge()', 'never retry']
    const reasons = [
      'retries every request, unsafe for payments',
      'chosen: only charges are idempotent',
      'leaves customers stranded on a single timeout'
    ]

    const recorded = await callOk(fx, 'record_decision', decisionArgs(threadId, { options, option_reasons: reasons }))
    const stored = storedDecision(fx.repo, stringOf(recorded, 'decision_id'))
    assert.deepEqual(stored.options, options, 'options must stay a list of strings')
    assert.deepEqual(stored.option_reasons, reasons, 'the reasons must be stored in the order of options')

    await assertRefusedNaming(fx, threadId, { options, option_reasons: reasons.slice(0, 2) }, 'option_reasons')
    await assertRefusedNaming(fx, threadId, { options, option_reasons: [reasons[0], ' \n ', reasons[2]] }, 'option_reasons')

    const plain = await callOk(fx, 'record_decision', decisionArgs(threadId, { options }))
    const storedPlain = storedDecision(fx.repo, stringOf(plain, 'decision_id'))
    assert.deepEqual(storedPlain.options, options)
    assert.equal(Object.hasOwn(storedPlain, 'option_reasons'), false, 'a decision recorded without reasons stores no option_reasons key')
  })
})

test('decision-standard.renders-reasons-in-briefing-resource-and-search', async () => {
  await withFixture(async (fx) => {
    const threadId = await openFixtureThread(fx, 'reasons-are-shown')
    const options = ['retry in the client', 'retry inside charge()']
    const reasons = ['retries every request, unsafe for payments', 'chosen: only charges are idempotent']
    const decisionId = stringOf(
      await callOk(fx, 'record_decision', decisionArgs(threadId, { options, option_reasons: reasons })),
      'decision_id'
    )
    const optionLines = options.map((option, index) => `- ${option}: ${reasons[index]}`)

    const briefingLines = (await fullBriefingNaming(fx, threadId, decisionId)).split('\n')
    for (const line of optionLines) {
      assert.ok(briefingLines.includes(line), `the briefing must show "${line}" on one line, got:\n${briefingLines.join('\n')}`)
    }

    const resourceLines = (await readResourceText(fx, `logbook://decision/${decisionId}`)).split('\n')
    for (const line of optionLines) {
      assert.ok(resourceLines.includes(line), `the decision resource must show "${line}" on one line, got:\n${resourceLines.join('\n')}`)
    }

    const searched = await callOk(fx, 'search_ledger', { text: 'idempotent' })
    assert.ok(
      stringOf(searched, 'results').includes(decisionId),
      `search_ledger must find the decision by a word only its reason holds, got:\n${stringOf(searched, 'results')}`
    )
  })
})

test('decision-standard.renders-a-decision-without-reasons-as-before', async () => {
  await withFixture(async (fx) => {
    const threadId = await openFixtureThread(fx, 'no-reasons-as-before')
    const options = ['retry in the client', 'retry inside charge()']
    const decisionId = stringOf(await callOk(fx, 'record_decision', decisionArgs(threadId, { options })), 'decision_id')
    const expected = ['Options:', ...options.map((option) => `- ${option}`)].join('\n')

    const briefing = await fullBriefingNaming(fx, threadId, decisionId)
    assert.ok(briefing.includes(`${expected}\nOutcome: `), `the briefing must render each option as "- <option>", got:\n${briefing}`)

    const resource = await readResourceText(fx, `logbook://decision/${decisionId}`)
    assert.ok(resource.includes(`${expected}\nOutcome: `), `the resource must render each option as "- <option>", got:\n${resource}`)
  })
})
