import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionStart } from '../../src/hook/session-start.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { claimPickup, readHold } from '../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime }

const SESSION = 'S'
const OTHER_SESSION = 'R'
const NEWEST = 'fix-login'
const OLDER = 'old-work'
const STORED_AT = '2026-11-17T09:00:00.000Z'
const PICKED_UP = 'Logbook picked up thread'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (slug: string, title: string): string =>
  [
    `# ${slug}: ${title}`,
    'Status: parked',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    `${title}.`,
    '',
    '## Done when',
    '',
    '- [ ] c1 The work is finished',
    '',
    '## Where things stand',
    '',
    'Started.',
    '',
    '## Next step',
    '',
    'Carry on.',
    '',
    '## Decisions in force',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/work.md',
    ''
  ].join('\n')

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const withTwoParkedThreads = (fn: (fixture: Fixture) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-startup-contention-'))
  try {
    const repo = join(root, 'repo')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'Contention Tester'])
    mustGit(repo, ['config', 'user.email', 'contention@logbook.test'])
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
      changes: [
        { slug: NEWEST, text: stateDocument(NEWEST, 'Fix the login page'), expectedBlob: null },
        { slug: OLDER, text: stateDocument(OLDER, 'Tidy the old work'), expectedBlob: null }
      ],
      message: 'park_thread: parked'
    })
    assert.ok(committed.ok, JSON.stringify(committed))
    fn({ repo, paths: found.value, rt })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const startupContext = (fixture: Fixture): string => {
  const output = sessionStart({
    event: { session_id: SESSION, cwd: fixture.repo, hook_event_name: 'SessionStart', source: 'startup' },
    sessionId: SESSION,
    paths: fixture.paths,
    rt: fixture.rt
  })
  const specific: unknown = 'hookSpecificOutput' in output ? output.hookSpecificOutput : undefined
  assert.ok(isRecord(specific), `the startup must add context, got ${JSON.stringify(output)}`)
  return String(specific.additionalContext)
}

test('startup-contention.newest-thread-another-startup-is-claiming-gives-the-roster-not-an-older-thread', () => {
  withTwoParkedThreads((fixture) => {
    const otherClaim = claimPickup(fixture.rt, fixture.paths, NEWEST, OTHER_SESSION, process.pid)
    assert.ok(otherClaim !== null, 'the other startup must win its claim on the newest thread')
    try {
      const context = startupContext(fixture)
      assert.equal(context.startsWith(PICKED_UP), false, context)
      assert.equal(readHold(fixture.paths, OLDER), null)
      assert.equal(readHold(fixture.paths, NEWEST), null)
    } finally {
      otherClaim.release()
    }
  })
})

test('startup-contention.newest-thread-a-running-session-holds-is-passed-over-for-the-next-free-one', () => {
  withTwoParkedThreads((fixture) => {
    const otherClaim = claimPickup(fixture.rt, fixture.paths, NEWEST, OTHER_SESSION, process.pid)
    assert.ok(otherClaim !== null, 'the other startup must win its claim on the newest thread')
    otherClaim.release()
    const otherStartup = sessionStart({
      event: { session_id: OTHER_SESSION, cwd: fixture.repo, hook_event_name: 'SessionStart', source: 'startup' },
      sessionId: OTHER_SESSION,
      paths: fixture.paths,
      rt: fixture.rt
    })
    assert.ok('hookSpecificOutput' in otherStartup, JSON.stringify(otherStartup))
    assert.equal(readHold(fixture.paths, NEWEST)?.holder, OTHER_SESSION)
    const context = startupContext(fixture)
    assert.ok(context.startsWith(`${PICKED_UP} ${OLDER} at session start`), context)
    assert.equal(readHold(fixture.paths, OLDER)?.holder, SESSION)
  })
})
