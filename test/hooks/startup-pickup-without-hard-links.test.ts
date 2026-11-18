import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionStart } from '../../src/hook/session-start.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { claimPickup, readHold } from '../../src/thread/holds.ts'
import { findRepository, pickupLockPath, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime }

const SESSION = 'S'
const OTHER_SESSION = 'R'
const SLUG = 'fix-login'
const RUNTIME_START = '2026-11-17T10:00:00.000Z'
const LOCK_WRITTEN_MOMENTS_AGO = new Date('2026-11-17T09:59:59.000Z')
const LOCK_LEFT_HOURS_AGO = new Date('2026-11-17T07:00:00.000Z')
const PICKED_UP = `Logbook picked up thread ${SLUG} at session start`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (): string =>
  [
    `# ${SLUG}: Fix the login page`,
    'Status: parked',
    'Updated: 2026-11-17T09:00:00.000Z',
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

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const withParkedThread = (fn: (fixture: Fixture) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-startup-no-links-'))
  try {
    const repo = join(root, 'repo')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'No Links Tester'])
    mustGit(repo, ['config', 'user.email', 'no-links@logbook.test'])
    mustGit(repo, ['commit', '--quiet', '--allow-empty', '-m', 'initial commit'])
    const rt = testRuntime({
      start: RUNTIME_START,
      stepMs: 0,
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

const unsupported = (): never => {
  throw Object.assign(new Error('ENOTSUP: operation not supported on socket, link'), { code: 'ENOTSUP' })
}

const onFilesystemWithoutHardLinks = (fn: () => void): void => {
  const realLink = fs.linkSync
  fs.linkSync = unsupported
  syncBuiltinESMExports()
  try {
    fn()
  } finally {
    fs.linkSync = realLink
    syncBuiltinESMExports()
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

const lockOf = (fixture: Fixture): string => {
  const lock = pickupLockPath(fixture.paths, SLUG)
  assert.ok(lock.ok, 'the pickup lock path must be built')
  return lock.value
}

const lockCaughtBeforeItsContent = (fixture: Fixture, writtenAt: Date): void => {
  const lock = lockOf(fixture)
  mkdirSync(join(lock, '..'), { recursive: true })
  writeFileSync(lock, '')
  utimesSync(lock, writtenAt, writtenAt)
}

test('startup-no-hard-links.startup-picks-up-the-thread-on-a-filesystem-without-hard-links', () => {
  withParkedThread((fixture) => {
    onFilesystemWithoutHardLinks(() => {
      const context = startupContext(fixture)
      assert.ok(context.startsWith(PICKED_UP), context)
      assert.equal(readHold(fixture.paths, SLUG)?.holder, SESSION)
    })
  })
})

test('startup-no-hard-links.claim-is-exclusive-on-a-filesystem-without-hard-links', () => {
  withParkedThread((fixture) => {
    onFilesystemWithoutHardLinks(() => {
      const first = claimPickup(fixture.rt, fixture.paths, SLUG, OTHER_SESSION, process.pid)
      assert.ok(first !== null, 'the first claim must be won')
      assert.equal(claimPickup(fixture.rt, fixture.paths, SLUG, SESSION, process.pid), null)
      first.release()
      const second = claimPickup(fixture.rt, fixture.paths, SLUG, SESSION, process.pid)
      assert.ok(second !== null, 'a released claim must leave the thread claimable')
      second.release()
    })
  })
})

test('startup-no-hard-links.lock-created-moments-ago-whose-content-is-not-written-yet-is-left-to-its-claimant', () => {
  withParkedThread((fixture) => {
    lockCaughtBeforeItsContent(fixture, LOCK_WRITTEN_MOMENTS_AGO)
    assert.equal(claimPickup(fixture.rt, fixture.paths, SLUG, SESSION, process.pid), null)
  })
})

test('startup-no-hard-links.lock-left-empty-for-hours-is-removed-and-the-claim-is-won', () => {
  withParkedThread((fixture) => {
    lockCaughtBeforeItsContent(fixture, LOCK_LEFT_HOURS_AGO)
    const claim = claimPickup(fixture.rt, fixture.paths, SLUG, SESSION, process.pid)
    assert.ok(claim !== null, 'an abandoned empty lock must not block the pickup')
    claim.release()
  })
})
