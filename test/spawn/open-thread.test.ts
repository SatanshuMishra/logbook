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
    throw new Error(`open-thread fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-open-thread-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Open Thread Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'open-thread@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook open-thread fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-open-thread-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-open-thread-home-'))
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

const GREEN_SUITE_CRITERION = 'the merge suite is green in both push orders'
const LATENCY_CRITERION = 'what counts as acceptable latency is not decided'

const callOpenThread = async (fx: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fx.spawned.client.callTool({ name: 'open_thread', arguments: args })) as CallToolResult

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const lineCarrying = (text: string, needle: string): string => {
  const found = text.split('\n').find((line) => line.includes(needle))
  assert.ok(found !== undefined, `expected the reply to carry a line for "${needle}", got: ${text}`)
  return found
}

const readThreadRecord = (fx: Fixture, threadId: string): Thread => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`open-thread fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`open-thread fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

test('open_thread.refuses-a-thread-with-no-active-goal', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, { title: 'a thread', slug: 'no-goal', next_step: 'read the spec' })

    assert.equal(reply.isError, true, 'a thread that does not say what the work is cannot be opened')
  })
})

test('open_thread.refuses-a-whitespace-only-next-step', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'blank-next-step',
      active_goal: 'ship the recording model',
      next_step: '   '
    })

    assert.equal(reply.isError, true, 'a next step made only of spaces states nothing and is refused')
  })
})

test('open_thread.accepts-a-thread-carrying-no-criteria', async () => {
  await withFixture(async (fx) => {
    const withEmpty = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'empty-criteria',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: []
    })
    const withAbsent = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'absent-criteria',
      active_goal: 'ship the recording model',
      next_step: 'read the spec'
    })

    assert.equal(withEmpty.isError, undefined, 'an empty criteria array opens a thread')
    assert.equal(withAbsent.isError, undefined, 'an absent criteria argument opens a thread')
  })
})

test('open_thread.writes-the-goal-and-the-next-step-into-the-spine', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'spine-populated',
      active_goal: 'ship the recording model',
      next_step: 'read the spec'
    })

    const structured = reply.structuredContent as { thread_id: string }
    const thread = readThreadRecord(fx, structured.thread_id)

    assert.equal(thread.spine.active_goal, 'ship the recording model', 'the goal a fresh session reads first is populated at open')
    assert.equal(thread.spine.next_step, 'read the spec', 'the next step a fresh session reads first is populated at open')
  })
})

test('open_thread.refuses-a-criterion-with-no-settledness', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'no-settledness',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [{ text: 'the suite is green', check: 'npm test exits 0' }]
    })

    assert.equal(reply.isError, true, 'settledness is declared at creation and never derived')
  })
})

test('open_thread.refuses-a-proposed-criterion-with-no-check', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'proposed-no-check',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [{ text: 'the suite is green', settledness: 'proposed' }]
    })

    assert.equal(reply.isError, true, 'a proposed criterion asserts something, so something must decide it')
  })
})

test('open_thread.accepts-an-unsettled-criterion-with-no-check', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'unsettled-no-check',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [{ text: 'what counts as acceptable latency is not decided', settledness: 'unsettled' }]
    })

    assert.equal(reply.isError, undefined, 'an unsettled criterion asserts nothing, so there is no claim for a check to decide')
  })
})

test('open_thread.refuses-a-confirmed-criterion-with-no-quote', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'confirmed-no-quote',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [{ text: 'the suite is green', check: 'npm test exits 0', settledness: 'confirmed' }]
    })

    assert.equal(reply.isError, true, 'claiming the human confirmed a criterion costs typing their words')
  })
})

test('open_thread.refuses-a-quote-on-a-criterion-nobody-confirmed', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'proposed-with-quote',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [
        { text: 'the suite is green', check: 'npm test exits 0', settledness: 'proposed', settled_by: 'they said so' }
      ]
    })

    assert.equal(reply.isError, true, 'a quote on a criterion nobody confirmed attributes words to nobody')
  })
})

test('open_thread.accepts-all-three-settledness-values', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'all-three-values',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [
        { text: 'the suite is green', check: 'npm test exits 0', settledness: 'proposed' },
        { text: 'the gate fires', check: 'the stop-gate tests pass', settledness: 'confirmed', settled_by: 'it has to block' },
        { text: 'what counts as acceptable latency is not decided', settledness: 'unsettled' }
      ]
    })

    assert.equal(reply.isError, undefined, 'no call is ever refused because of the settledness value itself')
  })
})

test('open_thread.reply-carries-the-text-of-every-criterion-it-stored', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'reply-carries-text',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [
        { text: GREEN_SUITE_CRITERION, check: 'npm test exits 0', settledness: 'proposed' },
        { text: LATENCY_CRITERION, settledness: 'unsettled' }
      ]
    })

    const text = firstTextOf(reply)

    assert.ok(text.includes(GREEN_SUITE_CRITERION), `the reply must carry the first criterion as stored, got: ${text}`)
    assert.ok(text.includes(LATENCY_CRITERION), `the reply must carry the second criterion as stored, got: ${text}`)
  })
})

test('open_thread.reply-carries-the-settledness-each-criterion-was-stored-with', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'reply-carries-settledness',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [
        { text: GREEN_SUITE_CRITERION, check: 'npm test exits 0', settledness: 'proposed' },
        { text: LATENCY_CRITERION, settledness: 'unsettled' }
      ]
    })

    const text = firstTextOf(reply)

    assert.ok(
      lineCarrying(text, GREEN_SUITE_CRITERION).includes('proposed'),
      `the settledness of a criterion belongs on that criterion's own line, got: ${text}`
    )
    assert.ok(
      lineCarrying(text, LATENCY_CRITERION).includes('unsettled'),
      `the settledness of a criterion belongs on that criterion's own line, got: ${text}`
    )
  })
})

test('open_thread.reply-names-the-action-and-where-the-answer-is-recorded', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'reply-names-the-action',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [{ text: GREEN_SUITE_CRITERION, check: 'npm test exits 0', settledness: 'proposed' }]
    })

    const text = firstTextOf(reply)

    assert.ok(text.includes('human'), `the reply must name putting the criteria to the human, got: ${text}`)
    assert.ok(text.includes('criteria_settled'), `the reply must name where the answer is recorded, got: ${text}`)
    assert.ok(text.includes('update_thread'), `the reply must name the tool that records the answer, got: ${text}`)
  })
})

test('open_thread.reply-with-no-criteria-says-a-definition-of-done-is-still-owed', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'reply-with-no-criteria',
      active_goal: 'ship the recording model',
      next_step: 'read the spec'
    })

    const text = firstTextOf(reply)

    assert.ok(
      text.includes('no completion criteria were recorded'),
      `a thread opened with no criteria must say so, got: ${text}`
    )
    assert.ok(
      text.includes('definition of done is still owed'),
      `a thread opened with no criteria still owes a definition of done, got: ${text}`
    )
  })
})

test('open_thread.reports-an-absent-check-as-null-rather-than-an-empty-string', async () => {
  await withFixture(async (fx) => {
    const reply = await callOpenThread(fx, {
      title: 'a thread',
      slug: 'absent-check-is-null',
      active_goal: 'ship the recording model',
      next_step: 'read the spec',
      completion_criteria: [{ text: LATENCY_CRITERION, settledness: 'unsettled' }]
    })

    const structured = reply.structuredContent as { completion_criteria: { check: string | null }[] }
    const first = structured.completion_criteria[0]

    assert.ok(first !== undefined, 'open-thread fixture: the unsettled criterion was not minted')
    assert.equal(
      first.check,
      null,
      'an unsettled criterion records no check, and null says that where an empty string is indistinguishable from a check someone stored as empty'
    )
  })
})
