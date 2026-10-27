import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { rawGit } from '../support/git-fixture.ts'
import type { HookProcessResult } from '../support/run-hook.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; store: string; workingCopy: string }

type Line = Record<string, unknown>

const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const SESSION = 's-1'
const C1_OPEN = '- [ ] c1 The login page loads'
const C2_OPEN = '- [ ] c2 Errors show under the form'

const fixLogin = (criteria: readonly string[]): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c3 D2 R2 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    ...criteria,
    '',
    '## Where things stand',
    '',
    'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    'Fix the submit handler.',
    '',
    '## Decisions in force',
    '',
    '- D1 Keep the session cookie: the mobile app reads it',
    '',
    '## Open risks',
    '',
    '- R1 The staging database may be stale',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md',
    ''
  ].join('\n')

const STORED = fixLogin([C1_OPEN, C2_OPEN])

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `logbook-metrics-document-${label}-`))

const withThread = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = scratch('repo')
  const home = scratch('home')
  const store = scratch('store')
  try {
    initRepo(repo)
    const { findRepository, workingCopyPath } = await import('../../src/thread/paths.ts')
    const { commitDocuments } = await import('../../src/thread/store.ts')
    const { takeHold } = await import('../../src/thread/holds.ts')
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: SESSION })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: STORED, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
    takeHold(rt, found.value, 'fix-login', SESSION, null)
    const workingCopy = workingCopyPath(found.value, 'fix-login')
    assert.ok(workingCopy.ok, 'the working copy path must be built')
    await fn({ repo, home, store, workingCopy: workingCopy.value })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(store, { recursive: true, force: true })
  }
}

const writeFile = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const editEvent = (fixture: Fixture, file: string): Record<string, unknown> => ({
  session_id: SESSION,
  transcript_path: join(fixture.home, 'transcripts', `${SESSION}.jsonl`),
  cwd: fixture.repo,
  prompt_id: 'p0',
  hook_event_name: 'PostToolUse',
  tool_use_id: 'toolu_00',
  tool_name: 'Edit',
  tool_input: { file_path: file, old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false },
  tool_response: { filePath: file }
})

const runPost = async (fixture: Fixture, file: string): Promise<HookProcessResult> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({
    hook: 'post-tool-use',
    event: editEvent(fixture, file),
    env: { HOME: fixture.home, PLUGIN_METRICS_DIR: fixture.store }
  })
  assert.equal(run.code, 0, run.stderr)
  return run
}

const eventFolder = (fixture: Fixture): string =>
  join(fixture.store, 'plugin=logbook', 'kind=event', `repo=${basename(fixture.repo)}`)

const runFiles = (fixture: Fixture): string[] => {
  const folder = eventFolder(fixture)
  return existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.startsWith('fix-login.') && name.endsWith('.jsonl'))
        .map((name) => join(folder, name))
    : []
}

const linesOf = (file: string): Line[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Line)

const lastLine = (fixture: Fixture): Line => {
  const files = runFiles(fixture)
  assert.equal(files.length, 1, `expected one run file, found ${JSON.stringify(files)}`)
  const line = linesOf(files[0] ?? '').at(-1)
  assert.ok(line !== undefined, 'the run must hold a line')
  return line
}

const storeFiles = (folder: string): string[] =>
  existsSync(folder)
    ? readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => join(folder, name))
    : []

test('metrics.accepted-edit-recorded', async () => {
  await withThread(async (fixture) => {
    writeFile(fixture.workingCopy, fixLogin(['- [x] c1 The login page loads evidence: the login test passed', C2_OPEN]))
    await runPost(fixture, fixture.workingCopy)
    const line = lastLine(fixture)
    assert.equal(line.event, 'doc.edit')
    assert.equal(line.outcome, 'accepted')
    assert.deepEqual(line.rules, [])
    assert.equal(line.violations, 0)
    assert.equal(line.refusal_field, null)
    assert.equal(line.session, 's-1')
  })
})

test('metrics.refused-edit-names-rules', async () => {
  await withThread(async (fixture) => {
    writeFile(fixture.workingCopy, fixLogin(['- [x] c1 The login page loads', '- [x] c2 Errors show under the form']))
    const run = await runPost(fixture, fixture.workingCopy)
    const line = lastLine(fixture)
    assert.equal(line.event, 'doc.edit')
    assert.equal(line.outcome, 'refused')
    assert.deepEqual(line.rules, ['box'])
    assert.equal(line.violations, 2)
    assert.equal(line.refusal_field, null)
    const output = JSON.parse(run.stdout)
    const context: unknown = output.hookSpecificOutput?.additionalContext
    assert.equal(typeof context, 'string', run.stdout)
    assert.ok(String(context).startsWith('logbook: the edit to '), String(context))
  })
})

test('metrics.failed-edit-names-field', async () => {
  await withThread(async (fixture) => {
    rmSync(fixture.workingCopy, { force: true })
    mkdirSync(fixture.workingCopy, { recursive: true })
    await runPost(fixture, fixture.workingCopy)
    const line = lastLine(fixture)
    assert.equal(line.event, 'doc.edit')
    assert.equal(line.outcome, 'failed')
    assert.deepEqual(line.rules, [])
    assert.equal(line.violations, 0)
    assert.equal(line.refusal_field, 'working_copy')
  })
})

test('metrics.unchanged-edit-records-nothing', async () => {
  await withThread(async (fixture) => {
    writeFile(fixture.workingCopy, STORED)
    await runPost(fixture, fixture.workingCopy)
    const docEdits = storeFiles(fixture.store)
      .flatMap(linesOf)
      .filter((line) => line.event === 'doc.edit')
    assert.deepEqual(docEdits, [])
  })
})
