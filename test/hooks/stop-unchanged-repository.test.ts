import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sessionStart } from '../../src/hook/session-start.ts'
import { stop, type StopOutput } from '../../src/hook/stop.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { readHold } from '../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const SLUG = 'fix-login'
const SESSION = 'session-s'
const STORED_AT = '2026-11-17T09:00:00.000Z'
const AFTER = '2026-11-17T09:05:00.000Z'
const PROVISIONAL_LINE =
  'Logbook picked this thread up at session start; record only work that belongs to thread fix-login.'
const TRACKED_FILE = 'login.js'

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime; transcript: string }

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const fixLogin = (): string =>
  [
    '# fix-login: Fix the login page',
    'Status: parked',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The login page loads',
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
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md',
    ''
  ].join('\n')

const withPickedUpThread = (fn: (fixture: Fixture) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-stop-unchanged-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'Stop Unchanged Tester'])
    mustGit(repo, ['config', 'user.email', 'stop-unchanged@logbook.test'])
    writeFileSync(join(repo, TRACKED_FILE), 'export const submit = () => {}\n')
    mustGit(repo, ['add', TRACKED_FILE])
    mustGit(repo, ['commit', '--quiet', '-m', 'add the login page'])
    const rt = testRuntime({
      cwd: repo,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        PLUGIN_METRICS_DIR: join(root, 'metrics'),
        CLAUDE_PID: String(process.pid)
      },
      sessionId: SESSION
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: SLUG, text: fixLogin(), expectedBlob: null }],
      message: `park_thread ${SLUG}: parked`
    })
    assert.ok(seeded.ok, JSON.stringify(seeded))
    fn({ repo, paths: found.value, rt, transcript: join(home, 'transcripts', `${SESSION}.jsonl`) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const startup = (fixture: Fixture): void => {
  sessionStart({
    event: { session_id: SESSION, cwd: fixture.repo, hook_event_name: 'SessionStart', source: 'startup' },
    sessionId: SESSION,
    paths: fixture.paths,
    rt: fixture.rt
  })
  assert.equal(readHold(fixture.paths, SLUG)?.provisional, true, 'the startup must pick the thread up')
}

const writeBashTurn = (file: string, command: string): void => {
  const lines = [
    {
      type: 'assistant',
      timestamp: AFTER,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command } }] }
    },
    {
      type: 'user',
      timestamp: AFTER,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: 'done' }] }
    }
  ]
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

const runStop = (fixture: Fixture): StopOutput =>
  stop({
    event: {
      session_id: SESSION,
      transcript_path: fixture.transcript,
      cwd: fixture.repo,
      hook_event_name: 'Stop',
      stop_hook_active: false
    },
    sessionId: SESSION,
    paths: fixture.paths,
    rt: fixture.rt
  })

const contextOf = (output: StopOutput): string | undefined =>
  'hookSpecificOutput' in output ? output.hookSpecificOutput.additionalContext : undefined

test('stop-unchanged.read-only-session-after-pickup-is-not-asked', () => {
  withPickedUpThread((fixture) => {
    startup(fixture)
    writeBashTurn(fixture.transcript, 'git log --oneline')
    assert.equal(contextOf(runStop(fixture)), undefined)
    assert.equal(readHold(fixture.paths, SLUG)?.provisional_asked, undefined, 'the one ask must stay unused')
  })
})

test('stop-unchanged.commit-after-pickup-is-asked-about', () => {
  withPickedUpThread((fixture) => {
    startup(fixture)
    writeFileSync(join(fixture.repo, TRACKED_FILE), 'export const submit = () => post()\n')
    mustGit(fixture.repo, ['commit', '--quiet', '-am', 'fix the submit handler'])
    writeBashTurn(fixture.transcript, 'git commit -am "fix the submit handler"')
    const context = contextOf(runStop(fixture))
    assert.ok(context?.split('\n').includes(PROVISIONAL_LINE), context)
  })
})

test('stop-unchanged.further-edit-to-a-file-already-changed-at-pickup-is-asked-about', () => {
  withPickedUpThread((fixture) => {
    appendFileSync(join(fixture.repo, TRACKED_FILE), 'export const draft = 1\n')
    startup(fixture)
    appendFileSync(join(fixture.repo, TRACKED_FILE), 'export const reset = () => {}\n')
    writeBashTurn(fixture.transcript, `cat >> ${TRACKED_FILE}`)
    const context = contextOf(runStop(fixture))
    assert.ok(context?.split('\n').includes(PROVISIONAL_LINE), context)
  })
})
