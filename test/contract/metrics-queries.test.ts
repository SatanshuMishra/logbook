import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const CATALOGUE_FILE = join(LOGBOOK_ROOT, 'src', 'metrics', 'catalogue.json')
const SKILL_FILE = join(LOGBOOK_ROOT, 'skills', 'metrics', 'SKILL.md')
const C1_OPEN = /^- \[ \] c1 (.*)$/m
const SQL_FENCE = '```sql'
const FENCE_END = '```'
const ROOT_PLACEHOLDER = '<root>'

const QUERY_COLUMNS: Record<string, string[]> = {
  pickups_by_source: ['source', 'pickups'],
  edit_outcomes: ['outcome', 'edits'],
  refused_edit_rules: ['rule', 'edits'],
  tool_refusals: ['tool', 'refusal_field', 'calls'],
  thread_lifetimes: ['run', 'status', 'lifetime_seconds']
}

const OPEN_ARGS = {
  slug: 'fix-login',
  title: 'Fix the login page',
  goal: 'Users can log in again.',
  next_step: 'Fix the submit handler.',
  criteria: ['The login page loads']
}

const DECISION_ARGS = {
  thread_id: 'fix-login',
  title: 'Keep the session cookie',
  context: 'The mobile app reads the session cookie.',
  options: ['keep the cookie', 'move to a token'],
  outcome: 'keep the cookie, because the mobile app reads it'
}

type Line = Record<string, unknown>

type Folders = { repo: string; home: string; store: string }

type NamedQuery = { name: string; question: string; sql: string }

type SqlBlock = { label: string; sql: string }

type DuckdbRun = { status: number | null; stdout: string; stderr: string }

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `logbook-metrics-queries-${label}-`))

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

const hookEvent = (folders: Folders, hookEventName: string, fields: Line): Line => ({
  session_id: 's-1',
  transcript_path: join(folders.home, 'P', 's-1.jsonl'),
  cwd: folders.repo,
  hook_event_name: hookEventName,
  ...fields
})

const runHook = async (folders: Folders, hook: string, event: Line): Promise<void> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook, event, env: { HOME: folders.home, PLUGIN_METRICS_DIR: folders.store } })
  assert.equal(run.code, 0, run.stderr)
}

const editEvent = (folders: Folders, workingCopy: string, toolUseId: string): Line =>
  hookEvent(folders, 'PostToolUse', {
    prompt_id: 'p-0',
    tool_use_id: toolUseId,
    tool_name: 'Edit',
    tool_input: { file_path: workingCopy, old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false },
    tool_response: { filePath: workingCopy }
  })

const milestoneEvent = (folders: Folders): Line =>
  hookEvent(folders, 'PostToolUse', {
    prompt_id: 'p-1',
    tool_use_id: 'toolu_10',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m x' },
    tool_response: { stdout: '[main 1234567] x', stderr: '' }
  })

const storedText = async (folders: Folders): Promise<string> => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { readDocument } = await import('../../src/thread/store.ts')
  const rt = testRuntime({ cwd: folders.repo, env: { PATH: process.env.PATH, HOME: folders.home }, sessionId: 's-1' })
  const found = findRepository(rt, folders.repo)
  assert.ok(found.ok, 'the test repository must be found')
  const text = readDocument(rt, found.value, 'fix-login')?.text
  assert.equal(typeof text, 'string')
  return String(text)
}

const runScratchThread = async (folders: Folders): Promise<void> => {
  const spawned = await spawnServer({
    projectRoot: folders.repo,
    entry: ENTRY,
    env: { HOME: folders.home, PLUGIN_METRICS_DIR: folders.store, CLAUDE_CODE_SESSION_ID: 's-1' }
  })
  try {
    const opened = await callTool(spawned, 'open_thread', OPEN_ARGS)
    const workingCopy = String((opened.structuredContent as Line | undefined)?.path)
    await callTool(spawned, 'update_thread', { thread_id: 'fix-login', next_step: 'Write the login test.' })
    const refused = await rawCall(spawned, 'update_thread', {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c9', result: 'the login test passed' }]
    })
    assert.equal(refused.isError, true, JSON.stringify(refused))
    await callTool(spawned, 'record_decision', DECISION_ARGS)
    const stored = await storedText(folders)
    assert.match(stored, C1_OPEN)
    writeFileSync(workingCopy, stored.replace(C1_OPEN, '- [x] c1 $1'))
    await runHook(folders, 'post-tool-use', editEvent(folders, workingCopy, 'toolu_00'))
    writeFileSync(workingCopy, stored.replace(C1_OPEN, '- [x] c1 $1 evidence: the login test passed'))
    await runHook(folders, 'post-tool-use', editEvent(folders, workingCopy, 'toolu_01'))
    await runHook(folders, 'session-start', hookEvent(folders, 'SessionStart', { source: 'compact' }))
    await runHook(folders, 'post-tool-use', milestoneEvent(folders))
    await callTool(spawned, 'park_thread', { thread_id: 'fix-login' })
    await callTool(spawned, 'resume_thread', { thread_id: 'fix-login' })
    await callTool(spawned, 'close_thread', { thread_id: 'fix-login', outcome: 'done', detail: 'the login page works' })
  } finally {
    await spawned.close()
  }
}

const executableOn = (folder: string): string | null => {
  const candidate = join(folder, 'duckdb')
  try {
    accessSync(candidate, constants.X_OK)
    return candidate
  } catch {
    return null
  }
}

const duckdbPath = (): string => {
  const configured = process.env.PLUGIN_METRICS_DUCKDB
  if (configured !== undefined && configured !== '') return configured
  const found = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((folder) => folder !== '')
    .map(executableOn)
    .find((candidate): candidate is string => candidate !== null)
  assert.ok(
    found !== undefined,
    'DuckDB was not found at PLUGIN_METRICS_DUCKDB or on PATH: install it with brew install duckdb'
  )
  return found
}

const runDuckdb = (home: string, sql: string): DuckdbRun => {
  const result = spawnSync(duckdbPath(), ['-json'], {
    input: sql,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: home }
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const rowsOf = (run: DuckdbRun, what: string): Line[] => {
  assert.equal(run.status, 0, `${what} failed: ${run.stderr}`)
  const rows: unknown = JSON.parse(run.stdout)
  assert.ok(Array.isArray(rows), `${what} printed ${run.stdout}`)
  return rows as Line[]
}

const skillText = (): string => readFileSync(SKILL_FILE, 'utf8')

const sqlBlocks = (text: string): SqlBlock[] => {
  const lines = text.split('\n')
  return lines.flatMap((line, index) => {
    if (line !== SQL_FENCE) return []
    const close = lines.findIndex((candidate, at) => at > index && candidate === FENCE_END)
    assert.ok(close > index, `the sql block opened on line ${index + 1} must close`)
    return [{ label: lines[index - 1] ?? '', sql: lines.slice(index + 1, close).join('\n') }]
  })
}

const blockFor = (label: string, root: string): string => {
  const block = sqlBlocks(skillText()).find((candidate) => candidate.label === label)
  assert.ok(block !== undefined, `the skill must hold a block after the line ${label}`)
  return block.sql.replaceAll(ROOT_PLACEHOLDER, root)
}

const frontmatter = (text: string): Record<string, string> => {
  const lines = text.split('\n')
  assert.equal(lines[0], '---', 'the skill must open with frontmatter')
  const close = lines.findIndex((line, index) => index > 0 && line === '---')
  assert.ok(close > 0, 'the frontmatter must close')
  return Object.fromEntries(
    lines.slice(1, close).map((line) => {
      const colon = line.indexOf(':')
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]
    })
  )
}

const namedQueries = (): NamedQuery[] => (JSON.parse(readFileSync(CATALOGUE_FILE, 'utf8')) as { queries: NamedQuery[] }).queries

test('metrics.named-queries-run', async () => {
  await import('../../src/metrics/record.ts')
  await withFolders(async (folders) => {
    await runScratchThread(folders)
    const [probe] = rowsOf(runDuckdb(folders.home, blockFor('Probe:', folders.store)), 'the probe')
    assert.ok(probe !== undefined, 'the probe must return a row')
    assert.ok(Number(probe.events) >= 1, JSON.stringify(probe))
    assert.ok(Number(probe.summaries) >= 1, JSON.stringify(probe))
    const present = blockFor('Present:', folders.store)
    const queries = namedQueries()
    assert.deepEqual(
      queries.map((query) => query.name).sort(),
      Object.keys(QUERY_COLUMNS).sort()
    )
    for (const query of queries) {
      const rows = rowsOf(runDuckdb(folders.home, `${present}\n${query.sql};\n`), query.name)
      assert.ok(rows.length >= 1, `${query.name} must return at least one row`)
      for (const row of rows) assert.deepEqual(Object.keys(row), QUERY_COLUMNS[query.name], query.name)
    }
  })
})

test('metrics.views-over-empty-store', async () => {
  const root = scratch('empty-store')
  try {
    const probe = rowsOf(runDuckdb(root, blockFor('Probe:', root)), 'the probe')
    assert.deepEqual(probe, [{ events: 0, summaries: 0 }])
    const empty = blockFor('Empty:', root)
    for (const view of ['events', 'summaries']) {
      const run = runDuckdb(root, `${empty}\nselect count(*) as n from ${view};\n`)
      assert.equal(run.status, 0, run.stderr)
      assert.deepEqual(JSON.parse(run.stdout), [{ n: 0 }])
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('metrics.skill-names-its-parts', () => {
  const text = skillText()
  const front = frontmatter(text)
  assert.equal(front.name, 'metrics')
  assert.ok((front.description ?? '').includes('logbook'), String(front.description))
  const body = text.slice(text.indexOf('---', 3) + 3)
  for (const part of ['catalogue.json', 'plugin=logbook', 'events', 'summaries', 'duckdb', 'brew install duckdb']) {
    assert.ok(body.includes(part), `the skill body must contain ${part}`)
  }
  const openings = body.split('\n').filter((line) => line.startsWith(SQL_FENCE))
  assert.equal(openings.length, 3)
  assert.deepEqual(
    sqlBlocks(body).map((block) => block.label),
    ['Probe:', 'Present:', 'Empty:']
  )
})
