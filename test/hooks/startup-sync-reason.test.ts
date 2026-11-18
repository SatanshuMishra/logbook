import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionStart } from '../../src/hook/session-start.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime }

const SESSION = 'S'
const SLUG = 'fix-login'
const STORED_AT = '2026-11-17T09:00:00.000Z'
const CONTEXT_CEILING = 9500
const COULD_NOT_SYNC = 'Logbook could not sync threads with origin: '
const REMOTE_LINE = 'remote: error: the server refused the request and printed a long explanation of why'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (): string =>
  [
    `# ${SLUG}: Fix the login page`,
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
    ...Array.from({ length: 70 }, (_, index) => `- Finding ${index}: the submit handler drops the session cookie on retry.`),
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

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const withParkedThread = (fn: (fixture: Fixture) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-startup-sync-reason-'))
  try {
    const repo = join(root, 'repo')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'Claim Tester'])
    mustGit(repo, ['config', 'user.email', 'claim@logbook.test'])
    mustGit(repo, ['commit', '--quiet', '--allow-empty', '-m', 'initial commit'])
    const rt = testRuntime({
      cwd: repo,
      env: {
        PATH: process.env.PATH,
        HOME: join(root, 'home'),
        PLUGIN_METRICS_DIR: join(root, 'metrics'),
        CLAUDE_PID: String(process.pid)
      },
      sessionId: SESSION
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const committed = commitDocuments(rt, found.value, {
      changes: [{ slug: SLUG, text: stateDocument(), expectedBlob: null }],
      message: `park_thread ${SLUG}: parked`
    })
    assert.ok(committed.ok, JSON.stringify(committed))
    fn({ repo, paths: found.value, rt })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const startupContext = (fixture: Fixture, syncError: string): string => {
  const output = sessionStart({
    event: { session_id: SESSION, cwd: fixture.repo, hook_event_name: 'SessionStart', source: 'startup' },
    sessionId: SESSION,
    paths: fixture.paths,
    rt: fixture.rt,
    syncError
  })
  const specific: unknown = 'hookSpecificOutput' in output ? output.hookSpecificOutput : undefined
  assert.ok(isRecord(specific), `the startup must add context, got ${JSON.stringify(output)}`)
  return String(specific.additionalContext)
}

const verboseFailure = (): string =>
  `fetch from origin failed: ${Array.from({ length: 150 }, (_, index) => `${REMOTE_LINE} ${index}`).join(' ')}`

test('startup-sync-reason.long-reason-keeps-the-context-under-the-ceiling', () => {
  withParkedThread((fixture) => {
    const context = startupContext(fixture, verboseFailure())
    assert.ok(context.length <= CONTEXT_CEILING, `context is ${context.length} characters`)
    assert.ok(context.includes(stateDocument().trimEnd()), 'the whole state document must stay in the context')
    const warnings = context.split('\n').filter((line) => line.startsWith(COULD_NOT_SYNC))
    assert.equal(warnings.length, 1, context)
    assert.match(warnings[0] ?? '', /^Logbook could not sync threads with origin: fetch from origin failed: remote: error/)
    assert.ok(warnings[0]?.endsWith('This copy may be behind origin.'), warnings[0])
  })
})

test('startup-sync-reason.reason-on-several-lines-stays-one-warning-line', () => {
  withParkedThread((fixture) => {
    const context = startupContext(fixture, 'fetch from origin failed: first line\nsecond line')
    const warnings = context.split('\n').filter((line) => line.startsWith(COULD_NOT_SYNC))
    assert.deepEqual(warnings, [
      `${COULD_NOT_SYNC}fetch from origin failed: first line second line. This copy may be behind origin.`
    ])
  })
})
