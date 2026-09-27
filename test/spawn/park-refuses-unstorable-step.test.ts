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
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readPointer, writePointer, type Pointer, type PointerRead } from '../../src/domain/pointer.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`park-refuses-unstorable-step fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-park-unstorable-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Park Unstorable Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'park-unstorable@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook park-refuses-unstorable-step fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-park-unstorable-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-park-unstorable-home-'))
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

const fixtureRuntime = (fx: Fixture): Runtime =>
  testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })

const fixtureLayout = (fx: Fixture): StoreLayout => {
  const layout = layoutFor(fixtureRuntime(fx), fx.repo)
  if (!layout.ok) throw new Error(`park-refuses-unstorable-step fixture: could not resolve the store layout: ${layout.message}`)
  return layout.value
}

const currentPointer = (fx: Fixture): PointerRead => readPointer(fixtureRuntime(fx), fixtureLayout(fx))

const storedNextSteps = (fx: Fixture): { id: string; next_step: string }[] => {
  const opened = openStore(fixtureRuntime(fx), fx.repo)
  if (!opened.ok) throw new Error(`park-refuses-unstorable-step fixture: could not open the store: ${opened.message}`)
  return opened.value
    .readThreads()
    .flatMap((slot) => (slot.quarantined ? [] : [{ id: slot.record.id, next_step: slot.record.spine.next_step }]))
}

const openThread = async (fx: Fixture, slug: string): Promise<string> => {
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
  return structured.thread_id as string
}

const resumeThread = async (fx: Fixture, threadId: string): Promise<Pointer> => {
  assertOk('resume_thread', await callTool(fx, 'resume_thread', { thread_id: threadId }))
  const pointer = currentPointer(fx)
  if (pointer.kind !== 'pointer') throw new Error(`expected resume_thread to mark ${threadId} as being worked, found ${pointer.kind}`)
  return pointer.value
}

const workATerminalThread = async (fx: Fixture): Promise<Pointer> => {
  const threadId = await openThread(fx, 'terminal-worked')
  const worked = await resumeThread(fx, threadId)
  assertOk(
    'close_thread (terminal setup)',
    await callTool(fx, 'close_thread', { thread_id: threadId, outcome: 'abandoned', detail: 'closed so the pointer names a terminal thread' })
  )
  writePointer(fixtureRuntime(fx), fixtureLayout(fx), worked)
  return worked
}

const UNSTORABLE_STEP = { next_step: 'In src/config.ts, raise HTTP_TIMEOUT_MS to 5000', next_step_records: [] }

const STEP_NOT_STORED = /the next step and its records list were NOT stored and must be re-sent/

const assertRefusedNamingTheStep = (label: string, result: CallToolResult): void => {
  assert.equal(result.isError, true, `${label} must be refused, got: ${JSON.stringify(result.content)}`)
  const text = firstTextOf(result)
  assert.equal(text.split('\n')[0], 'field: next_step', `${label} must name the field the call carried, not an outcome it never sent:\n${text}`)
  assert.doesNotMatch(text, /outcome omitted/, `${label} must not suggest a retry that omits only the outcome:\n${text}`)
  assert.match(text, STEP_NOT_STORED, `${label} must name the next step and its records list as not stored:\n${text}`)
}

test('park.refuses-a-next-step-it-cannot-store', async () => {
  await withFixture(async (fx) => {
    await openThread(fx, 'nothing-worked')
    const before = storedNextSteps(fx)

    assertRefusedNamingTheStep('park_thread with a next step while no thread is being worked', await callTool(fx, 'park_thread', UNSTORABLE_STEP))
    assert.deepEqual(storedNextSteps(fx), before, 'a refused park must change no stored next_step')
    assert.equal(currentPointer(fx).kind, 'absent', 'a refused park must not create a pointer')
  })

  await withFixture(async (fx) => {
    const worked = await workATerminalThread(fx)
    const before = storedNextSteps(fx)

    assertRefusedNamingTheStep('park_thread with a next step while the worked thread is terminal', await callTool(fx, 'park_thread', UNSTORABLE_STEP))
    assert.deepEqual(storedNextSteps(fx), before, 'a refused park must change no stored next_step')
    assert.deepEqual(currentPointer(fx), { kind: 'pointer', value: worked }, 'a refused park must leave the pointer in place')
  })

  await withFixture(async (fx) => {
    const workedId = await openThread(fx, 'worked-thread')
    const otherId = await openThread(fx, 'other-open-thread')
    const worked = await resumeThread(fx, workedId)
    const before = storedNextSteps(fx)

    assertRefusedNamingTheStep(
      'park_thread with a next step and a thread_id that is not the worked thread',
      await callTool(fx, 'park_thread', { ...UNSTORABLE_STEP, thread_id: otherId })
    )
    assert.deepEqual(storedNextSteps(fx), before, 'a refused park must change no stored next_step')
    assert.deepEqual(currentPointer(fx), { kind: 'pointer', value: worked }, 'a refused park must leave the pointer in place')
  })
})

test('park.releases-when-it-carries-nothing', async () => {
  await withFixture(async (fx) => {
    await openThread(fx, 'nothing-worked')

    const parked = assertOk('park_thread carrying nothing while no thread is being worked', await callTool(fx, 'park_thread', {}))
    assert.equal(parked.status, 'nothing-to-park')
  })

  await withFixture(async (fx) => {
    await workATerminalThread(fx)

    const parked = assertOk('park_thread carrying nothing while the worked thread is terminal', await callTool(fx, 'park_thread', {}))
    assert.equal(parked.status, 'terminal-pointer-released')
    assert.equal(parked.pointer_released, true)
    assert.equal(currentPointer(fx).kind, 'absent', 'a park carrying nothing must release a pointer naming a terminal thread')
  })
})
