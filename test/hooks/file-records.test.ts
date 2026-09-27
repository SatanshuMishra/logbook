import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolReply } from '../../src/server/register.ts'
import { TOOL_SPECS } from '../../src/server/tools/index.ts'
import { openStore } from '../../src/store/records.ts'
import { indexRecords, type IndexedRecord } from '../../src/domain/record-index.ts'
import { renderRecordFull } from '../../src/render/briefing.ts'
import { renderThreadListing } from '../../src/cli/session-start.ts'
import { STUB_TOOL_CTX, withCriterionFixture } from '../support/criterion-fixture.ts'
import { controlledEnv, freshTmpDir, runHookProcessWithEvent, type HookName } from './hook-process.ts'

type Structured = Record<string, unknown>

const GOVERNED_FILE = 'src/config.ts'
const UNGOVERNED_FILE = 'README.md'
const TRIGGER_PHRASE = 'the file this call reads or changes'
const TIMEOUT_OUTCOME = 'keep HTTP_TIMEOUT_MS at or below 3000 so gateway retries finish inside the upstream deadline'
const MANY_DECISIONS = 5
const OUTCOME_FILLER = 'the gateway timeout stays bounded by the upstream deadline '
const OUTCOME_FILLER_REPEATS = 280
const MANY_RECORDS_MIN_CHARS = 30000
const LISTED_THREADS = 3
const NEXT_STEP_FILLER = 'retune the gateway retry budget '
const NEXT_STEP_FILLER_REPEATS = 200
const TRANSPORT_CLIP_GRAPHEMES = 14000

const halt = (detail: string): never => {
  throw new Error(`file-records fixture: ${detail}`)
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

const projectOf = (rt: Runtime): string => rt.cwd ?? halt('the fixture runtime carries no project directory')

const pluginDataOf = (rt: Runtime): string =>
  rt.env.CLAUDE_PLUGIN_DATA ?? halt('the fixture runtime carries no CLAUDE_PLUGIN_DATA')

const writeProjectFiles = (project: string): void => {
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, GOVERNED_FILE), 'export const HTTP_TIMEOUT_MS = 3000\n')
}

const openThread = async (rt: Runtime, slug: string, nextStep: string): Promise<{ threadId: string; criterionId: string }> => {
  const opened = await callTool(rt, 'open_thread', {
    title: `the ${slug} thread`,
    slug,
    active_goal: `keep the ${slug} work honest`,
    next_step: nextStep,
    next_step_records: [],
    completion_criteria: [{ text: `the ${slug} gateway answers within its deadline`, check: 'npm test exits 0', settledness: 'proposed' }]
  })
  return { threadId: textOf(opened, 'thread_id'), criterionId: onlyIdOf(opened, 'completion_criteria') }
}

const recordDecision = async (rt: Runtime, threadId: string, fields: Structured): Promise<string> =>
  textOf(await callTool(rt, 'record_decision', { thread_id: threadId, options: ['keep it', 'raise it'], ...fields }), 'decision_id')

const closeAsDone = async (rt: Runtime, threadId: string, criterionId: string): Promise<void> => {
  await callTool(rt, 'update_thread', {
    thread_id: threadId,
    criteria_done: [{ criterion_id: criterionId, result: 'the gateway suite passed', result_status: 'verified' }]
  })
  await callTool(rt, 'close_thread', { thread_id: threadId, outcome: 'done', detail: 'the gateway work shipped' })
}

const seedClosedThread = async (rt: Runtime, decisions: readonly Structured[]): Promise<void> => {
  writeProjectFiles(projectOf(rt))
  const { threadId, criterionId } = await openThread(rt, 'gateway-timeout', 'read the gateway module')
  for (const decision of decisions) await recordDecision(rt, threadId, decision)
  await closeAsDone(rt, threadId, criterionId)
}

const TIMEOUT_DECISION: Structured = {
  title: 'Keep the HTTP timeout short',
  context: `the HTTP timeout lives in ${GOVERNED_FILE} and the gateway retries on it`,
  outcome: TIMEOUT_OUTCOME
}

const seedTimeoutRuling = (rt: Runtime): Promise<void> => seedClosedThread(rt, [TIMEOUT_DECISION])

type HookOutput = { status: number | null; stderr: string; additionalContext: string | null }

const runHookFor = (rt: Runtime, hookName: HookName, event: Structured): HookOutput => {
  const result = runHookProcessWithEvent(hookName, event, { env: controlledEnv({ CLAUDE_PLUGIN_DATA: pluginDataOf(rt) }) })
  const parsed: unknown = result.stdout.length === 0 ? {} : JSON.parse(result.stdout)
  const output = (parsed as { hookSpecificOutput?: { additionalContext?: unknown } }).hookSpecificOutput
  const context = output?.additionalContext
  return { status: result.status, stderr: result.stderr, additionalContext: typeof context === 'string' ? context : null }
}

type Touch = { sessionId: string; toolName?: string; file: string; cwd?: string; filePath?: string; agentId?: string }

const touchFile = (rt: Runtime, touch: Touch): HookOutput => {
  const cwd = touch.cwd ?? projectOf(rt)
  const filePath = touch.filePath ?? path.join(cwd, ...touch.file.split('/'))
  const toolName = touch.toolName ?? 'Read'
  const toolInput = toolName === 'Edit' ? { file_path: filePath, old_string: '3000', new_string: '2500' } : { file_path: filePath }
  const output = runHookFor(rt, 'pre-tool-use', {
    session_id: touch.sessionId,
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    ...(touch.agentId === undefined ? {} : { agent_id: touch.agentId })
  })
  assert.equal(output.status, 0, `expected the PreToolUse hook to exit 0, stderr: ${output.stderr}`)
  return output
}

const assertCarriesTheRuling = (output: HookOutput, label: string): void => {
  assert.ok(output.additionalContext !== null, `${label}: expected additionalContext, got none`)
  assert.ok(output.additionalContext.includes(TIMEOUT_OUTCOME), `${label}: expected the decision's outcome in the context`)
  assert.ok(output.additionalContext.includes(TRIGGER_PHRASE), `${label}: expected the context to say ${TRIGGER_PHRASE}`)
}

const assertAddsNothing = (output: HookOutput, label: string): void => {
  assert.equal(output.additionalContext, null, `${label}: expected no additionalContext`)
}

test('file-records.first-read-of-a-governed-file-adds-its-records', async () => {
  await withCriterionFixture(async (rt) => {
    await seedTimeoutRuling(rt)
    assertCarriesTheRuling(touchFile(rt, { sessionId: 'first-read', file: GOVERNED_FILE }), 'the first read')
  })
})

test('file-records.later-touches-of-the-same-file-add-nothing', async () => {
  await withCriterionFixture(async (rt) => {
    await seedTimeoutRuling(rt)
    assertCarriesTheRuling(touchFile(rt, { sessionId: 'later-touches', file: GOVERNED_FILE }), 'the first read')
    assertAddsNothing(touchFile(rt, { sessionId: 'later-touches', file: GOVERNED_FILE }), 'the second read')
    assertAddsNothing(touchFile(rt, { sessionId: 'later-touches', toolName: 'Edit', file: GOVERNED_FILE }), 'the edit after')
    assertCarriesTheRuling(
      touchFile(rt, { sessionId: 'later-touches-next-session', file: GOVERNED_FILE }),
      'the first read in a new session'
    )
  })
})

test('file-records.a-helper-and-its-parent-each-see-the-records', async () => {
  await withCriterionFixture(async (rt) => {
    await seedTimeoutRuling(rt)
    const helper = 'a41c2e9f0b7d4c1a'
    assertCarriesTheRuling(
      touchFile(rt, { sessionId: 'helper-and-parent', file: GOVERNED_FILE, agentId: helper }),
      "the helper's first read"
    )
    assertCarriesTheRuling(touchFile(rt, { sessionId: 'helper-and-parent', file: GOVERNED_FILE }), "the parent's first read")
    assertAddsNothing(
      touchFile(rt, { sessionId: 'helper-and-parent', file: GOVERNED_FILE, agentId: helper }),
      "the helper's second read"
    )
  })
})

test('file-records.a-file-no-record-names-adds-nothing', async () => {
  await withCriterionFixture(async (rt) => {
    await seedTimeoutRuling(rt)
    assertCarriesTheRuling(touchFile(rt, { sessionId: 'ungoverned-file', file: GOVERNED_FILE }), 'the governed read')
    assertAddsNothing(touchFile(rt, { sessionId: 'ungoverned-file', file: UNGOVERNED_FILE }), 'the ungoverned read')
  })
})

test('file-records.a-path-through-a-symbolic-link-matches', async () => {
  await withCriterionFixture(async (rt) => {
    await seedTimeoutRuling(rt)
    const linkHome = freshTmpDir('logbook-file-records-link-')
    try {
      const link = path.join(linkHome, 'project-link')
      symlinkSync(projectOf(rt), link)
      assertCarriesTheRuling(
        touchFile(rt, { sessionId: 'through-a-link', file: GOVERNED_FILE, cwd: link }),
        'the read through a symbolic link'
      )
    } finally {
      rmSync(linkHome, { recursive: true, force: true })
    }
  })
})

const manyDecisions = (): Structured[] =>
  Array.from({ length: MANY_DECISIONS }, (_, index) => ({
    title: `Bound the gateway timeout, ruling ${index + 1}`,
    context: `the HTTP timeout in ${GOVERNED_FILE} governs gateway retries, ruling ${index + 1}`,
    outcome: `${OUTCOME_FILLER.repeat(OUTCOME_FILLER_REPEATS)}final line of ruling ${index + 1}`
  }))

const governingRecords = (rt: Runtime): IndexedRecord[] => {
  const opened = openStore(rt, projectOf(rt))
  if (!opened.ok) return halt(`the store did not open: ${opened.message}`)
  return indexRecords(opened.value).filter(
    (record) => record.kind === 'decision' && record.fields.some((field) => field.includes(GOVERNED_FILE))
  )
}

const openListedThreads = async (rt: Runtime): Promise<void> => {
  for (let index = 1; index <= LISTED_THREADS; index += 1) {
    await openThread(rt, `listed-thread-${index}`, `${NEXT_STEP_FILLER.repeat(NEXT_STEP_FILLER_REPEATS)}step ${index}`)
  }
}

test('file-records.many-records-reach-the-session-whole', async () => {
  await withCriterionFixture(async (rt) => {
    await seedClosedThread(rt, manyDecisions())
    const records = governingRecords(rt)
    const blocks = records.map(renderRecordFull)
    assert.equal(records.length, MANY_DECISIONS)
    assert.ok(
      blocks.reduce((total, block) => total + block.length, 0) > MANY_RECORDS_MIN_CHARS,
      `expected the governing records' full texts to total more than ${MANY_RECORDS_MIN_CHARS} characters`
    )

    const output = touchFile(rt, { sessionId: 'many-records', file: GOVERNED_FILE })
    assert.ok(output.additionalContext !== null, 'expected additionalContext for the first read of the governed file')
    for (const block of blocks) {
      assert.ok(output.additionalContext.includes(block), 'expected every governing record in full in the context')
    }
    assert.ok(
      output.additionalContext.endsWith(`final line of ruling ${MANY_DECISIONS}`),
      `expected the context to end with the last decision's final line; it ends: ${output.additionalContext.slice(-120)}`
    )

    await openListedThreads(rt)
    const listing = renderThreadListing(rt, projectOf(rt))
    assert.ok(listing.length > TRANSPORT_CLIP_GRAPHEMES, 'expected the thread listing to exceed the transport clip')
    const prompted = runHookFor(rt, 'user-prompt-submit', {
      session_id: 'many-records',
      cwd: projectOf(rt),
      hook_event_name: 'UserPromptSubmit',
      prompt: 'resume where we left off'
    })
    assert.equal(prompted.status, 0, `expected the UserPromptSubmit hook to exit 0, stderr: ${prompted.stderr}`)
    assert.ok(prompted.additionalContext !== null, 'expected the UserPromptSubmit hook to add the thread listing')
    assert.equal(prompted.additionalContext.length, TRANSPORT_CLIP_GRAPHEMES)
    assert.ok(listing.startsWith(prompted.additionalContext), 'expected the listing to be clipped from its start')
  })
})
