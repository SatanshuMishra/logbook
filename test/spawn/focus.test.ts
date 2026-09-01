import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { readPointer } from '../../src/domain/pointer.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

const NO_WORKED_THREAD_FOCUS_REASON =
  'no thread is marked as being worked on this machine, so there was no session focus to set'
const DIFFERENT_THREAD_FOCUS_REASON =
  "the thread marked as being worked is a different thread, so this thread's focus was not set"
const OTHER_SESSION_FOCUS_REASON =
  'another session holds the record of what is being worked, so this session did not overwrite its focus'
const UNREADABLE_POINTER_FOCUS_REASON =
  "the record of what is being worked could not be read, so this session's focus was not set"

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`focus fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-focus-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Focus Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'focus@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook focus fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

type Fixture = { spawned: SpawnedServer; repo: string; pluginData: string; homeDir: string }

const withFixture = async (fn: (fx: Fixture) => Promise<void>, env: Record<string, string> = {}): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-focus-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-focus-home-'))
  const spawned = await spawnServer({
    projectRoot: repo,
    entry: ENTRY,
    env: { CLAUDE_PLUGIN_DATA: pluginData, ...env }
  })
  try {
    await fn({ spawned, repo, pluginData, homeDir })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

const firstTextOf = (result: CallToolResult): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the tool result to carry at least one text content block')
  return (first as { type: 'text'; text: string }).text
}

const assertRefusalOnFocus = (result: CallToolResult, unknownId: string): void => {
  assert.equal(result.isError, true, 'expected the call to be refused')
  const text = firstTextOf(result)
  const lines = text.split('\n')
  assert.equal(lines[0], 'field: focus', `expected the refusal to name field "focus", got "${lines[0]}"`)
  assert.match(text, /^accepted: /m)
  assert.match(text, /^example: /m)
  assert.match(text, /^retryable: (true|false)/m)
  assert.ok(
    text.includes(`focus names ids not present on this thread: ${unknownId}`),
    `expected the refusal message to name the focus id that names no criterion on this thread, got: ${text}`
  )
}

const assertDuplicateFocusRefusal = (result: CallToolResult, repeatedId: string): void => {
  assert.equal(result.isError, true, 'expected the call to be refused')
  const text = firstTextOf(result)
  const lines = text.split('\n')
  assert.equal(lines[0], 'field: focus', `expected the refusal to name field "focus", got "${lines[0]}"`)
  assert.match(text, /^accepted: /m)
  assert.match(text, /^example: /m)
  assert.match(text, /^retryable: (true|false)/m)
  assert.ok(
    text.includes(`focus names the same criterion more than once: ${repeatedId}`),
    `expected the refusal message to name the repeated focus id, got: ${text}`
  )
}

const createFixtureThread = async (
  spawned: SpawnedServer,
  overrides: Record<string, unknown> = {}
): Promise<{ threadId: string; criterionId: string }> => {
  const result = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'focus fixture thread',
      slug: 'focus-fixture-thread',
      completion_criteria: [{ text: 'a focus fixture criterion', check: 'a focus fixture check' }],
      ...overrides
    }
  })) as CallToolResult
  assertOkResult('open_thread (fixture arrange)', result)
  const structured = result.structuredContent as { thread_id: string; completion_criteria: { id: string }[] }
  const firstCriterion = structured.completion_criteria[0]
  assert.ok(firstCriterion !== undefined, 'focus fixture: open_thread arrange call minted no completion criteria')
  return { threadId: structured.thread_id, criterionId: firstCriterion.id }
}

const layoutInFixture = (fx: Fixture): StoreLayout => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const layout = layoutFor(rt, fx.repo)
  if (!layout.ok) throw new Error(`focus fixture: could not resolve the store layout: ${layout.message}`)
  return layout.value
}

const readPointerFocus = (fx: Fixture): string[] | null => {
  const rt = testRuntime({ env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData }, cwd: fx.repo })
  const layout = layoutInFixture(fx)
  const read = readPointer(rt, layout)
  if (read.kind !== 'pointer') return null
  return read.value.focus
}

const threadRecordRawText = (fx: Fixture, threadId: string): string => {
  const layout = layoutInFixture(fx)
  return readFileSync(join(layout.records, 'threads', `${threadId}.json`), 'utf8')
}

const writeCorruptPointer = (fx: Fixture): void => {
  const layout = layoutInFixture(fx)
  mkdirSync(layout.state, { recursive: true })
  writeFileSync(join(layout.state, 'active-thread.json'), 'not-json{{{', 'utf8')
}

test('resume_thread.records-focus-and-the-briefing-shows-it', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('resume_thread', resumed)
    const structured = resumed.structuredContent as { focus: string[]; briefing: string }
    assert.deepEqual(structured.focus, [criterionId])
    assert.ok(
      structured.briefing.includes('**Focus:** c1.'),
      'the returned briefing must name the focused criterion by its display label'
    )
  })
})

test('update_thread.writes-focus-to-this-sessions-pointer', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId }
    })) as CallToolResult
    assertOkResult('resume_thread (arrange)', resumed)
    assert.deepEqual(readPointerFocus(fx), [])

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, true)
    assert.equal(structured.focus_not_written_reason, null)

    assert.deepEqual(readPointerFocus(fx), [criterionId])
  })
})

test('update_thread.reports-focus-not-written-when-no-pointer-exists', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, false)
    assert.equal(structured.focus_not_written_reason, NO_WORKED_THREAD_FOCUS_REASON)
  })
})

test('update_thread.reports-focus-not-written-when-the-pointer-file-is-corrupt', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)
    writeCorruptPointer(fx)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, false)
    assert.equal(structured.focus_not_written_reason, NO_WORKED_THREAD_FOCUS_REASON)
  })
})

test('update_thread.persists-next-step-when-the-pointer-file-cannot-be-read', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)
    const layout = layoutInFixture(fx)
    const pointerPath = join(layout.state, 'active-thread.json')
    mkdirSync(layout.state, { recursive: true })
    mkdirSync(pointerPath)

    const suppliedNextStep = 'the next step that must survive an unreadable pointer file'
    try {
      const updated = (await fx.spawned.client.callTool({
        name: 'update_thread',
        arguments: { thread_id: threadId, focus: [criterionId], next_step: suppliedNextStep }
      })) as CallToolResult
      assertOkResult('update_thread (unreadable pointer file)', updated)
      const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
      assert.equal(structured.focus_written, false)
      assert.equal(structured.focus_not_written_reason, UNREADABLE_POINTER_FOCUS_REASON)

      const stored = JSON.parse(threadRecordRawText(fx, threadId)) as { spine: { next_step: string } }
      assert.equal(
        stored.spine.next_step,
        suppliedNextStep,
        'the next_step supplied alongside focus must be persisted even when the pointer file cannot be read'
      )
    } finally {
      rmSync(pointerPath, { recursive: true, force: true })
    }
  })
})

test('update_thread.reports-focus-not-written-when-the-pointer-names-another-thread', async () => {
  await withFixture(async (fx) => {
    const a = await createFixtureThread(fx.spawned, { slug: 'focus-thread-a' })
    const b = await createFixtureThread(fx.spawned, { slug: 'focus-thread-b' })

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: a.threadId }
    })) as CallToolResult
    assertOkResult('resume_thread (arrange)', resumed)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: b.threadId, focus: [b.criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)
    const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
    assert.equal(structured.focus_written, false)
    assert.equal(structured.focus_not_written_reason, DIFFERENT_THREAD_FOCUS_REASON)
  })
})

test('update_thread.reports-focus-not-written-when-another-session-holds-the-pointer', async () => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-focus-two-session-plugin-data-'))
  try {
    const sessionA = await spawnServer({
      projectRoot: repo,
      entry: ENTRY,
      env: { CLAUDE_PLUGIN_DATA: pluginData, CLAUDE_CODE_SESSION_ID: 'focus-session-a' }
    })
    try {
      const { threadId, criterionId } = await createFixtureThread(sessionA)
      const resumed = (await sessionA.client.callTool({
        name: 'resume_thread',
        arguments: { thread_id: threadId }
      })) as CallToolResult
      assertOkResult('resume_thread (session a)', resumed)

      const sessionB = await spawnServer({
        projectRoot: repo,
        entry: ENTRY,
        env: { CLAUDE_PLUGIN_DATA: pluginData, CLAUDE_CODE_SESSION_ID: 'focus-session-b' }
      })
      try {
        const updated = (await sessionB.client.callTool({
          name: 'update_thread',
          arguments: { thread_id: threadId, focus: [criterionId] }
        })) as CallToolResult
        assertOkResult('update_thread (session b)', updated)
        const structured = updated.structuredContent as { focus_written: boolean; focus_not_written_reason: string | null }
        assert.equal(structured.focus_written, false)
        assert.equal(structured.focus_not_written_reason, OTHER_SESSION_FOCUS_REASON)
      } finally {
        await sessionB.close()
      }
    } finally {
      await sessionA.close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test('resume_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned)
    const unknownId = testRuntime().ulid()

    const result = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [unknownId] }
    })) as CallToolResult
    assertRefusalOnFocus(result, unknownId)
  })
})

test('update_thread.refuses-a-focus-id-naming-no-criterion-on-this-thread', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned)
    const unknownId = testRuntime().ulid()

    const result = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [unknownId] }
    })) as CallToolResult
    assertRefusalOnFocus(result, unknownId)
  })
})

test('resume_thread.refuses-a-focus-id-repeated-in-the-same-call', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const result = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [criterionId, criterionId] }
    })) as CallToolResult
    assertDuplicateFocusRefusal(result, criterionId)
  })
})

test('update_thread.refuses-a-focus-id-repeated-in-the-same-call', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const result = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId, criterionId] }
    })) as CallToolResult
    assertDuplicateFocusRefusal(result, criterionId)
  })
})

test('update_thread.refusal-after-the-focus-write-leaves-the-pointer-focus-unchanged', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId }
    })) as CallToolResult
    assertOkResult('resume_thread (arrange)', resumed)
    assert.deepEqual(readPointerFocus(fx), [])

    const seedOutOfScope = Array.from({ length: 40 }, (_, index) => `seed out-of-scope entry ${index}`)
    const seeded = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, out_of_scope_add: seedOutOfScope }
    })) as CallToolResult
    assertOkResult('update_thread (seed to the out_of_scope cap)', seeded)

    const startingFocus = readPointerFocus(fx)
    assert.deepEqual(startingFocus, [])

    const overCap = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: {
        thread_id: threadId,
        focus: [criterionId],
        out_of_scope_add: ['one entry past the out_of_scope cap']
      }
    })) as CallToolResult
    assert.equal(overCap.isError, true, 'expected the call to be refused once out_of_scope exceeds its cap')

    const forgedFocus = readPointerFocus(fx)
    assert.deepEqual(
      forgedFocus,
      startingFocus,
      `expected the stored session pointer's focus to remain unchanged at ${JSON.stringify(startingFocus)} after the refused update_thread call, but found ${JSON.stringify(forgedFocus)}`
    )
  })
})

test('focus.never-reaches-the-thread-record', async () => {
  await withFixture(async (fx) => {
    const { threadId, criterionId } = await createFixtureThread(fx.spawned, {
      title: 'never-reaches-the-record fixture thread',
      slug: 'never-reaches-the-record-fixture-thread',
      completion_criteria: [{ text: 'a never-reaches-the-record fixture criterion', check: 'a never-reaches-the-record fixture check' }]
    })

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('resume_thread', resumed)

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, focus: [criterionId] }
    })) as CallToolResult
    assertOkResult('update_thread', updated)

    const raw = threadRecordRawText(fx, threadId)
    assert.equal(raw.includes('focus'), false, 'the stored thread record must never carry the string "focus"')
  })
})
