import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readHold, takeHold, type Hold } from '../../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { writeWorkingCopy } from '../../../src/thread/working-copy.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const COMMAND = join(fileURLToPath(new URL('../../..', import.meta.url)), 'bin', 'logbook')
const THREADS_REF = 'refs/logbook/threads'
const STORED_DOCUMENT = `${THREADS_REF}:fix-login.md`
const SPAWN_LIMIT_MS = 120000
const SESSION = 'sess-1'
const STORED_STANDING = 'The form renders but submitting it fails.'
const PENDING_STANDING = 'The submit handler drops the session cookie.'

const STATE_DOCUMENT = [
  '# fix-login: Fix the login page',
  'Status: active',
  'Updated: 2023-12-31T09:00:00.000Z',
  'Next ids: c2 D1 R1 S1',
  '',
  '## Goal',
  '',
  'Users can log in again.',
  '',
  '## Done when',
  '',
  '- [ ] c1 The login page loads.',
  '',
  '## Where things stand',
  '',
  STORED_STANDING,
  '',
  '## Next step',
  '',
  'Find the fault.',
  '',
  '## Decisions in force',
  '',
  '## Open risks',
  '',
  '## Settled, do not reopen',
  '',
  '## Where the details live',
  ''
].join('\n')

type Seeded = { repo: string; subfolder: string; paths: RepoPaths; env: Record<string, string> }

type Run = { status: number | null; stdout: string; stderr: string }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const withThread = (fn: (seeded: Seeded) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-session-command-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    const metrics = join(root, 'metrics')
    const subfolder = join(repo, 'src', 'login')
    mkdirSync(subfolder, { recursive: true })
    mkdirSync(home)
    mkdirSync(metrics)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Session Tester'])
    mustGit(repo, ['config', 'user.email', 'session@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'session command test repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '--quiet', '-m', 'initial commit'])
    const env = { PATH: process.env.PATH ?? '', HOME: home, PLUGIN_METRICS_DIR: metrics }
    const rt = testRuntime({ env, sessionId: SESSION })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the scratch repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: STATE_DOCUMENT, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, `the thread must be seeded: ${JSON.stringify(seeded)}`)
    fn({ repo, subfolder, paths: found.value, env })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const holdWithPendingEdit = (seeded: Seeded): string => {
  const rt = testRuntime({ env: seeded.env, sessionId: SESSION })
  takeHold(rt, seeded.paths, 'fix-login', SESSION, null)
  const storedBlob = mustGit(seeded.repo, ['rev-parse', STORED_DOCUMENT]).trim()
  const written = writeWorkingCopy(
    rt,
    seeded.paths,
    'fix-login',
    STATE_DOCUMENT.replace(STORED_STANDING, PENDING_STANDING),
    storedBlob
  )
  assert.ok(written.ok, `the working copy must be written: ${JSON.stringify(written)}`)
  return written.value
}

const runCommand = (args: readonly string[], cwd: string, env: Record<string, string>, input?: string): Run => {
  const result = spawnSync(COMMAND, [...args], { cwd, env, input, encoding: 'utf8', timeout: SPAWN_LIMIT_MS })
  assert.equal(result.error, undefined, `the command must start: ${String(result.error)}`)
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const describeRun = (run: Run): string =>
  `exit ${String(run.status)}, stdout ${JSON.stringify(run.stdout)}, stderr ${JSON.stringify(run.stderr)}`

const jsonLine = (run: Run): Record<string, unknown> => {
  assert.equal(run.status, 0, describeRun(run))
  const body = run.stdout.replace(/\n$/, '')
  assert.ok(body !== '' && !body.includes('\n'), `stdout must be one line: ${describeRun(run)}`)
  return JSON.parse(body) as Record<string, unknown>
}

const usageLine = (run: Run): string => {
  assert.equal(run.status, 2, describeRun(run))
  assert.equal(run.stdout, '', describeRun(run))
  const lines = run.stderr.replace(/\n$/, '').split('\n')
  assert.equal(lines.length, 1, describeRun(run))
  const line = lines[0] ?? ''
  assert.ok(line.startsWith('logbook: '), describeRun(run))
  return line
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS_REF]).trim()

const storedText = (repo: string): string => mustGit(repo, ['cat-file', 'blob', STORED_DOCUMENT])

const lastMessageLine = (repo: string): string => {
  const lines = mustGit(repo, ['log', '-1', '--format=%B', THREADS_REF]).replace(/\n+$/, '').split('\n')
  return lines[lines.length - 1] ?? ''
}

const holdOf = (seeded: Seeded): Hold | null => readHold(seeded.paths, 'fix-login')

const SHIP_IT = JSON.stringify({ thread_id: 'fix-login', next_step: 'Ship it.' })

test('session-command.update-from-stdin-writes-as-the-session', () => {
  withThread((seeded) => {
    holdWithPendingEdit(seeded)
    assert.equal(holdOf(seeded)?.folded_at, null)
    const run = runCommand(
      ['update_thread', '--args', '-'],
      seeded.subfolder,
      { ...seeded.env, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) },
      SHIP_IT
    )
    jsonLine(run)
    const stored = storedText(seeded.repo)
    assert.ok(stored.includes(PENDING_STANDING), stored)
    assert.ok(stored.includes('Ship it.'), stored)
    assert.equal(lastMessageLine(seeded.repo), `Writer: ${SESSION}`)
    assert.equal(typeof holdOf(seeded)?.folded_at, 'string')
  })
})

test('session-command.resume-takes-the-hold-with-claudes-process', () => {
  withThread((seeded) => {
    assert.equal(holdOf(seeded), null)
    const run = runCommand(
      ['resume_thread', '--args', JSON.stringify({ thread_id: 'fix-login' })],
      seeded.subfolder,
      { ...seeded.env, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) }
    )
    const result = jsonLine(run)
    assert.equal(result.thread_id, 'fix-login')
    assert.equal(result.briefing, storedText(seeded.repo))
    const hold = holdOf(seeded)
    assert.equal(hold?.holder, SESSION)
    assert.equal(hold?.process, process.pid)
  })
})

test('session-command.no-session-and-no-writer-is-a-usage-error', () => {
  withThread((seeded) => {
    const before = tipOf(seeded.repo)
    const run = runCommand(
      ['update_thread', '--args', '-'],
      seeded.subfolder,
      seeded.env,
      JSON.stringify({ thread_id: 'fix-login', next_step: 'x' })
    )
    assert.ok(usageLine(run).includes('--writer'), describeRun(run))
    assert.equal(tipOf(seeded.repo), before)
  })
})

test('session-command.malformed-session-id-is-a-usage-error', () => {
  withThread((seeded) => {
    const before = tipOf(seeded.repo)
    const run = runCommand(
      ['update_thread', '--args', '-'],
      seeded.subfolder,
      { ...seeded.env, CLAUDE_CODE_SESSION_ID: 'not a session id!' },
      JSON.stringify({ thread_id: 'fix-login', next_step: 'x' })
    )
    usageLine(run)
    assert.equal(tipOf(seeded.repo), before)
  })
})

test('session-command.writer-flag-beats-the-session', () => {
  withThread((seeded) => {
    const workingCopy = holdWithPendingEdit(seeded)
    const pending = readFileSync(workingCopy, 'utf8')
    const foldedAt = holdOf(seeded)?.folded_at
    const run = runCommand(
      ['update_thread', '--writer', 'run:demo', '--args', '-'],
      seeded.subfolder,
      { ...seeded.env, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) },
      SHIP_IT
    )
    jsonLine(run)
    assert.equal(lastMessageLine(seeded.repo), 'Writer: run:demo')
    assert.ok(!storedText(seeded.repo).includes(PENDING_STANDING))
    assert.equal(readFileSync(workingCopy, 'utf8'), pending)
    assert.equal(holdOf(seeded)?.folded_at, foldedAt)
  })
})

test('session-command.resume-refuses-a-run-writer', () => {
  withThread((seeded) => {
    const before = tipOf(seeded.repo)
    const run = runCommand(
      ['resume_thread', '--writer', 'run:demo', '--args', JSON.stringify({ thread_id: 'fix-login' })],
      seeded.subfolder,
      seeded.env
    )
    usageLine(run)
    assert.equal(holdOf(seeded), null)
    assert.equal(tipOf(seeded.repo), before)
  })
})
