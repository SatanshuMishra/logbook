import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { foldHold, readHold, takeHold } from '../../src/thread/holds.ts'
import { findRepository, workingCopyPath, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import type { HookProcessResult } from '../support/run-hook.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime; workingCopy: string; transcript: string }

type FixtureOptions = { held?: boolean; status?: string; folded?: boolean }

type Line = Record<string, unknown>

const FOLDED_MS = Date.UTC(2026, 9, 14, 9, 0)
const FOLDED_AT = new Date(FOLDED_MS).toISOString()
const BEFORE = new Date(FOLDED_MS - 60_000).toISOString()
const AFTER = new Date(FOLDED_MS + 60_000).toISOString()
const LATER = new Date(FOLDED_MS + 120_000).toISOString()

const UPDATE_OPENING = 'logbook: update the state document at '
const TURN_CHANGED = 'the turn changed something'
const BLOCKED_USER_WROTE = 'blocked or waiting and the user wrote'

const fixLogin = (status: string): string =>
  [
    '# fix-login: Fix the login page',
    `Status: ${status}`,
    `Updated: ${FOLDED_AT}`,
    'Next ids: c3 D2 R2 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The login page loads',
    '- [ ] c2 Errors show under the form',
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

const withThread = async (options: FixtureOptions, fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-stop-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-stop-home-'))
  try {
    initRepo(repo)
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 's1' })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: fixLogin(options.status ?? 'active'), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
    const transcript = join(home, 'transcripts', 's1.jsonl')
    if (options.held ?? true) takeHold(rt, found.value, 'fix-login', 's1', transcript)
    if ((options.held ?? true) && (options.folded ?? true)) foldHold(rt, found.value, 'fix-login', FOLDED_AT)
    const workingCopy = workingCopyPath(found.value, 'fix-login')
    assert.ok(workingCopy.ok, 'the working copy path must be built')
    await fn({ repo, home, paths: found.value, rt, workingCopy: workingCopy.value, transcript })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const userEntry = (text: string, timestamp: string): Line => ({
  type: 'user',
  timestamp,
  message: { role: 'user', content: text }
})

const assistantText = (text: string, timestamp: string): Line => ({
  type: 'assistant',
  timestamp,
  message: { role: 'assistant', content: [{ type: 'text', text }] }
})

const toolCall = (id: string, name: string, input: Record<string, unknown>, timestamp: string): Line => ({
  type: 'assistant',
  timestamp,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
})

const toolResult = (id: string, content: string, timestamp: string): Line => ({
  type: 'user',
  timestamp,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }
})

const writeTranscript = (file: string, lines: readonly Line[]): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

const stopEvent = (fixture: Fixture, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  session_id: 's1',
  transcript_path: fixture.transcript,
  cwd: fixture.repo,
  hook_event_name: 'Stop',
  stop_hook_active: false,
  ...fields
})

const runStop = async (fixture: Fixture, event: Record<string, unknown>): Promise<HookProcessResult> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook: 'stop', event, env: { HOME: fixture.home } })
  assert.equal(run.code, 0, run.stderr)
  return run
}

const outputOf = (run: HookProcessResult): Record<string, unknown> => {
  const output: unknown = JSON.parse(run.stdout)
  assert.ok(typeof output === 'object' && output !== null && !Array.isArray(output), `stdout was ${run.stdout}`)
  return output as Record<string, unknown>
}

const contextOf = (run: HookProcessResult): string => {
  const output = outputOf(run)
  assert.equal('decision' in output, false, `stdout was ${run.stdout}`)
  const specific = output.hookSpecificOutput as Record<string, unknown> | undefined
  assert.equal(specific?.hookEventName, 'Stop', `stdout was ${run.stdout}`)
  const context = specific?.additionalContext
  assert.equal(typeof context, 'string')
  return context as string
}

const assertQuiet = (run: HookProcessResult): void => {
  assert.deepEqual(outputOf(run), {})
}

const bashLines = (timestamp: string): Line[] => [
  toolCall('toolu_bash', 'Bash', { command: 'npm run build', description: 'build' }, timestamp),
  toolResult('toolu_bash', 'built', timestamp)
]

test('stop.nudges-after-a-change', async () => {
  await withThread({}, async (fixture) => {
    writeTranscript(fixture.transcript, [
      userEntry('Build the login page', BEFORE),
      ...bashLines(AFTER),
      assistantText('The build passed.', LATER)
    ])
    const run = await runStop(fixture, stopEvent(fixture))
    const context = contextOf(run)
    assert.ok(context.includes(TURN_CHANGED), context)
    assert.ok(context.includes(fixture.workingCopy), context)
    assert.ok(context.startsWith(`${UPDATE_OPENING}${fixture.workingCopy}.`), context)
    assert.equal(run.stdout.includes('"decision"'), false, run.stdout)
  })
})

test('stop.quiet-after-only-reads', async () => {
  await withThread({}, async (fixture) => {
    writeTranscript(fixture.transcript, [
      ...bashLines(BEFORE),
      toolCall('toolu_read', 'Read', { file_path: join(fixture.repo, 'README.md') }, AFTER),
      toolResult('toolu_read', 'logbook fixture repository', AFTER),
      toolCall('toolu_grep', 'Grep', { pattern: 'login', path: fixture.repo }, LATER),
      toolResult('toolu_grep', 'No matches found', LATER),
      assistantText('Nothing mentions login yet.', LATER)
    ])
    assertQuiet(await runStop(fixture, stopEvent(fixture)))
  })
})

test('stop.nudges-when-blocked-and-the-user-wrote', async () => {
  await withThread({ status: 'waiting: the owner picks' }, async (fixture) => {
    writeTranscript(fixture.transcript, [
      ...bashLines(BEFORE),
      assistantText('Which option should I take?', BEFORE),
      userEntry('Take the second option', AFTER),
      assistantText('Understood.', LATER)
    ])
    const context = contextOf(await runStop(fixture, stopEvent(fixture)))
    assert.ok(context.includes(BLOCKED_USER_WROTE), context)
    assert.ok(context.includes('"waiting: the owner picks"'), context)
    assert.ok(context.includes(fixture.workingCopy), context)
  })
})

test('stop.quiet-when-blocked-and-silent', async () => {
  await withThread({ status: 'blocked: x' }, async (fixture) => {
    writeTranscript(fixture.transcript, [
      userEntry('Wait for the staging database', BEFORE),
      ...bashLines(BEFORE),
      assistantText('Still blocked on the staging database.', AFTER)
    ])
    assertQuiet(await runStop(fixture, stopEvent(fixture)))
  })
})

test('stop.quiet-when-already-active', async () => {
  await withThread({}, async (fixture) => {
    writeTranscript(fixture.transcript, [...bashLines(AFTER), assistantText('Done.', LATER)])
    assertQuiet(await runStop(fixture, stopEvent(fixture, { stop_hook_active: true })))
  })
})

test('stop.quiet-without-a-hold', async () => {
  await withThread({ held: false }, async (fixture) => {
    writeTranscript(fixture.transcript, [...bashLines(AFTER), assistantText('Done.', LATER)])
    assertQuiet(await runStop(fixture, stopEvent(fixture)))
    assert.equal(readHold(fixture.paths, 'fix-login'), null)
  })
})

test('stop.counts-everything-before-the-first-update', async () => {
  await withThread({ folded: false }, async (fixture) => {
    const hold = readHold(fixture.paths, 'fix-login')
    assert.equal(hold?.folded_at, null)
    writeTranscript(fixture.transcript, [
      toolCall('toolu_write', 'Write', { file_path: join(fixture.repo, 'login.ts'), content: 'export {}\n' }, BEFORE),
      toolResult('toolu_write', 'File created successfully', BEFORE)
    ])
    const context = contextOf(await runStop(fixture, stopEvent(fixture)))
    assert.ok(context.startsWith(`${UPDATE_OPENING}${fixture.workingCopy}.`), context)
    assert.ok(context.includes(TURN_CHANGED), context)
    assert.ok(context.includes('Edit tool'), context)
  })
})
