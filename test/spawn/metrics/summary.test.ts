import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../../support/git-fixture.ts'
import type { HookProcessResult } from '../../support/run-hook.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const EVENT_FILE = /^fix-login\.([0-9]{8}T[0-9]{6}Z)\.jsonl$/

const OPEN_ARGS = {
  slug: 'fix-login',
  title: 'Fix the login page',
  goal: 'Users can log in again.',
  next_step: 'Fix the submit handler.'
}

const DECISION_ARGS = {
  thread_id: 'fix-login',
  title: 'Keep the session cookie',
  context: 'The mobile app reads the session cookie.',
  options: ['keep the cookie', 'move to a token'],
  outcome: 'keep the cookie, because the mobile app reads it'
}

const TOOL_CALL_FIELDS = { tool: 'open_thread', outcome: 'ok', refusal_field: null, call_seconds: 0 }

type Line = Record<string, unknown>

type Folders = { repo: string; home: string; store: string }

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `logbook-summary-${label}-`))

const makeRepo = (): string => {
  const repo = scratch('repo')
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFolders = async (fn: (folders: Folders) => Promise<void>): Promise<void> => {
  const folders = { repo: makeRepo(), home: scratch('home'), store: scratch('store') }
  try {
    await fn(folders)
  } finally {
    for (const folder of Object.values(folders)) rmSync(folder, { recursive: true, force: true })
  }
}

const withServer = async (folders: Folders, fn: (spawned: SpawnedServer) => Promise<void>): Promise<void> => {
  const spawned = await spawnServer({
    projectRoot: folders.repo,
    entry: ENTRY,
    env: { HOME: folders.home, PLUGIN_METRICS_DIR: folders.store, CLAUDE_CODE_SESSION_ID: 's-1' }
  })
  try {
    await fn(spawned)
  } finally {
    await spawned.close()
  }
}

const rawCall = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await spawned.client.callTool({ name, arguments: args })) as CallToolResult

const callTool = async (
  spawned: SpawnedServer,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> => {
  const reply = await rawCall(spawned, name, args)
  assert.equal(reply.isError, undefined, `expected ${name} to succeed, got: ${JSON.stringify(reply)}`)
  return reply
}

const replyText = (reply: CallToolResult): string =>
  reply.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n')

const runHook = async (folders: Folders, hook: string, event: Line): Promise<HookProcessResult> => {
  const { runHookProcess } = await import('../../support/run-hook.ts')
  const run = await runHookProcess({ hook, event, env: { HOME: folders.home, PLUGIN_METRICS_DIR: folders.store } })
  assert.equal(run.code, 0, run.stderr)
  return run
}

const hookEvent = (folders: Folders, hookEventName: string, fields: Line): Line => ({
  session_id: 's-1',
  transcript_path: join(folders.home, 'P', 's-1.jsonl'),
  cwd: folders.repo,
  hook_event_name: hookEventName,
  ...fields
})

const kindFolder = (folders: Folders, kind: string): string =>
  join(folders.store, 'plugin=logbook', `kind=${kind}`, `repo=${basename(folders.repo)}`)

const filesIn = (folder: string): string[] => (existsSync(folder) ? readdirSync(folder).sort() : [])

const linesOf = (file: string): Line[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Line)

const runStamp = (folders: Folders): string => {
  const files = filesIn(kindFolder(folders, 'event')).filter((name) => EVENT_FILE.test(name))
  assert.equal(files.length, 1, `expected one fix-login run file, got ${JSON.stringify(files)}`)
  return EVENT_FILE.exec(files[0] ?? '')?.[1] ?? ''
}

const runEvents = (folders: Folders): Line[] =>
  linesOf(join(kindFolder(folders, 'event'), `fix-login.${runStamp(folders)}.jsonl`))

const summaryFile = (folders: Folders): string =>
  join(kindFolder(folders, 'summary'), `fix-login.${runStamp(folders)}.json`)

const onlySummary = (folders: Folders): Line => {
  const file = summaryFile(folders)
  assert.ok(existsSync(file), `the summary file ${file} must exist`)
  const lines = linesOf(file)
  assert.equal(lines.length, 1)
  const [line] = lines
  assert.ok(line !== undefined)
  return line
}

test('metrics.park-writes-summary', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    await withServer(folders, async (spawned) => {
      await callTool(spawned, 'open_thread', OPEN_ARGS)
      await callTool(spawned, 'park_thread', { thread_id: 'fix-login' })
    })
    const summary = onlySummary(folders)
    assert.equal(summary.kind, 'summary')
    assert.equal(summary.event, 'run.summary')
    assert.equal(summary.status, 'parked')
    assert.equal(summary.tool_calls, 2)
  })
})

test('metrics.close-replaces-summary', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    await withServer(folders, async (spawned) => {
      await callTool(spawned, 'open_thread', { ...OPEN_ARGS, criteria: ['The login page loads'] })
      await callTool(spawned, 'park_thread', { thread_id: 'fix-login' })
      await callTool(spawned, 'resume_thread', { thread_id: 'fix-login' })
      await callTool(spawned, 'update_thread', {
        thread_id: 'fix-login',
        criteria_done: [{ criterion_id: 'c1', result: 'the login test passed' }]
      })
      await callTool(spawned, 'close_thread', { thread_id: 'fix-login', outcome: 'done', detail: 'the login page works' })
    })
    const summary = onlySummary(folders)
    assert.equal(summary.status, 'done')
    assert.equal(summary.tool_calls, 5)
  })
})

test('metrics.session-end-writes-summary', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    await withServer(folders, async (spawned) => {
      await callTool(spawned, 'open_thread', OPEN_ARGS)
    })
    await runHook(folders, 'session-end', hookEvent(folders, 'SessionEnd', { reason: 'logout' }))
    const summary = onlySummary(folders)
    assert.equal(summary.status, 'active')
    assert.equal(summary.session, 's-1')
  })
})

test('metrics.summary-figures', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    let refusedField = ''
    await withServer(folders, async (spawned) => {
      await callTool(spawned, 'open_thread', { ...OPEN_ARGS, criteria: ['The login page loads', 'Errors show under the form'] })
      await callTool(spawned, 'update_thread', {
        thread_id: 'fix-login',
        criteria_done: [{ criterion_id: 'c1', result: 'the login test passed' }],
        risks_add: [{ text: 'The staging database may be stale' }]
      })
      const refused = await rawCall(spawned, 'update_thread', {
        thread_id: 'fix-login',
        criteria_done: [{ criterion_id: 'c9', result: 'the login test passed' }]
      })
      assert.equal(refused.isError, true, JSON.stringify(refused))
      const firstLine = replyText(refused).split('\n')[0] ?? ''
      assert.ok(firstLine.startsWith('field: '), firstLine)
      refusedField = firstLine.slice('field: '.length)
      await callTool(spawned, 'record_decision', DECISION_ARGS)
      await callTool(spawned, 'park_thread', { thread_id: 'fix-login' })
    })
    const summary = onlySummary(folders)
    assert.equal(summary.status, 'parked')
    assert.equal(summary.sessions, 1)
    assert.equal(summary.tool_calls, 5)
    assert.equal(summary.tool_refusals, 1)
    assert.equal(summary.tool_crashes, 0)
    assert.deepEqual(summary.refusals, [{ tool: 'update_thread', field: refusedField, count: 1 }])
    assert.equal(summary.commits, 3)
    assert.equal(summary.criteria_ticked, 1)
    assert.equal(summary.risks_added, 1)
    assert.equal(summary.decisions_added, 1)
    assert.equal(summary.criteria_total, 2)
    assert.equal(summary.criteria_open, 1)
    assert.equal(summary.edits_accepted, 0)
    assert.equal(summary.edits_refused, 0)
    assert.equal(summary.edits_failed, 0)
    assert.deepEqual(summary.edit_rules, [])
    assert.equal(summary.pickups_resume, 0)
    assert.equal(summary.pickups_compact, 0)
    assert.equal(summary.pickups_clear, 0)
    assert.equal(summary.pickups_short, 0)
    assert.equal(summary.handovers, 0)
    assert.equal(summary.requests_milestone, 0)
    assert.equal(summary.requests_turn_changed, 0)
    assert.equal(summary.requests_blocked_user_wrote, 0)
    assert.equal(summary.context_chars, 0)
    assert.equal(typeof summary.lifetime_seconds, 'number')
    assert.ok(Number(summary.lifetime_seconds) >= 0, String(summary.lifetime_seconds))
    assert.equal('usd' in summary, false)
    assert.equal('tokens' in summary, false)
  })
})

test('metrics.summary-counts-hook-events', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    await withServer(folders, async (spawned) => {
      const opened = await callTool(spawned, 'open_thread', { ...OPEN_ARGS, criteria: ['The login page loads'] })
      const workingCopy = String((opened.structuredContent as Line | undefined)?.path)
      const { findRepository } = await import('../../../src/thread/paths.ts')
      const { readDocument } = await import('../../../src/thread/store.ts')
      const rt = testRuntime({ cwd: folders.repo, env: { PATH: process.env.PATH, HOME: folders.home }, sessionId: 's-1' })
      const found = findRepository(rt, folders.repo)
      assert.ok(found.ok, 'the test repository must be found')
      const storedText = readDocument(rt, found.value, 'fix-login')?.text
      assert.equal(typeof storedText, 'string')
      writeFileSync(workingCopy, String(storedText).replace('- [ ] c1', '- [x] c1'))
      await runHook(
        folders,
        'post-tool-use',
        hookEvent(folders, 'PostToolUse', {
          prompt_id: 'p-0',
          tool_use_id: 'toolu_00',
          tool_name: 'Edit',
          tool_input: { file_path: workingCopy, old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false },
          tool_response: { filePath: workingCopy }
        })
      )
      writeFileSync(workingCopy, String(storedText))
      await runHook(folders, 'session-start', hookEvent(folders, 'SessionStart', { source: 'compact' }))
      await callTool(spawned, 'park_thread', { thread_id: 'fix-login' })
    })
    const pickup = runEvents(folders).find((line) => line.event === 'thread.pickup')
    assert.ok(pickup !== undefined, 'the run must hold the pickup')
    const summary = onlySummary(folders)
    assert.equal(summary.edits_refused, 1)
    assert.deepEqual(summary.edit_rules, [{ rule: 'box', count: 1 }])
    assert.equal(summary.pickups_compact, 1)
    assert.equal(summary.context_chars, pickup.context_chars)
  })
})

test('metrics.summary-prunes-old-runs', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    const { appendEvent } = await import('../../../metrics/metrics-writer.ts')
    const environ = { PLUGIN_METRICS_DIR: folders.store }
    const repo = basename(folders.repo)
    const oldRuns = Array.from({ length: 101 }, (_, index) => {
      const start = new Date(Date.UTC(2020, 0, 1, 0, index))
      const stamp = start.toISOString().replace(/[-:]/g, '').replace(/\.[0-9]{3}Z$/, 'Z')
      return { run: `old-${index + 1}.${stamp}`, start }
    })
    assert.equal(oldRuns[0]?.run, 'old-1.20200101T000000Z')
    for (const { run, start } of oldRuns) {
      const warning = appendEvent({
        plugin: 'logbook',
        pluginVersion: '0.0.0',
        repo,
        run,
        event: 'tool.call',
        fields: TOOL_CALL_FIELDS,
        environ,
        now: start
      })
      assert.ok(warning === null || warning === undefined, String(warning))
    }
    const otherFile = join(folders.store, 'plugin=other', 'kind=event', `repo=${repo}`, 'other-run.jsonl')
    const otherText = '{"v":1,"plugin":"other"}\n'
    mkdirSync(dirname(otherFile), { recursive: true })
    writeFileSync(otherFile, otherText)
    await withServer(folders, async (spawned) => {
      await callTool(spawned, 'open_thread', OPEN_ARGS)
      await callTool(spawned, 'park_thread', { thread_id: 'fix-login' })
    })
    const remaining = filesIn(kindFolder(folders, 'event'))
    const oldFile = (index: number): string => `${oldRuns[index]?.run ?? ''}.jsonl`
    assert.equal(remaining.includes(oldFile(0)), false)
    assert.equal(remaining.includes(oldFile(1)), false)
    oldRuns.slice(2).forEach((_, offset) => {
      assert.ok(remaining.includes(oldFile(offset + 2)), `${oldFile(offset + 2)} must remain`)
    })
    assert.equal(remaining.filter((name) => EVENT_FILE.test(name)).length, 1)
    assert.equal(readFileSync(otherFile, 'utf8'), otherText)
  })
})
