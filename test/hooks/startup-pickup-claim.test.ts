import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

type Fixture = { root: string; repo: string; paths: RepoPaths; rt: Runtime }

const SESSION = 'S'
const OTHER_SESSION = 'R'
const SLUG = 'fix-login'
const STORED_AT = '2026-11-17T09:00:00.000Z'
const PICKED_UP = `Logbook picked up thread ${SLUG} at session start`

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
  const root = mkdtempSync(join(tmpdir(), 'logbook-startup-claim-'))
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
    fn({ root, repo, paths: found.value, rt })
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

const exitedProcess = (home: string): number => {
  const child = spawnSync(process.execPath, ['-e', ''], { env: { HOME: home } })
  assert.equal(child.status, 0, 'the short-lived child process must exit cleanly')
  assert.equal(typeof child.pid, 'number', 'the short-lived child process must have a process id')
  return child.pid as number
}

test('startup-claim.thread-another-startup-is-picking-up-is-left-to-it', () => {
  withParkedThread((fixture) => {
    const otherClaim = claimPickup(fixture.rt, fixture.paths, SLUG, OTHER_SESSION, process.pid)
    assert.ok(otherClaim !== null, 'the other startup must win its claim on an unclaimed thread')
    try {
      const context = startupContext(fixture)
      assert.equal(context.startsWith(PICKED_UP), false, context)
      assert.equal(readHold(fixture.paths, SLUG), null)
    } finally {
      otherClaim.release()
    }
  })
})

test('startup-claim.claim-of-an-ended-startup-does-not-block-the-pickup', () => {
  withParkedThread((fixture) => {
    const endedClaim = claimPickup(fixture.rt, fixture.paths, SLUG, OTHER_SESSION, exitedProcess(fixture.root))
    assert.ok(endedClaim !== null, 'the ended startup must have won its claim before it ended')
    const context = startupContext(fixture)
    assert.ok(context.startsWith(PICKED_UP), context)
    assert.equal(readHold(fixture.paths, SLUG)?.holder, SESSION)
  })
})

test('startup-claim.a-claim-is-refused-while-a-running-claimant-holds-one', () => {
  withParkedThread((fixture) => {
    const first = claimPickup(fixture.rt, fixture.paths, SLUG, OTHER_SESSION, process.pid)
    assert.ok(first !== null, 'the first claim must be won')
    assert.equal(claimPickup(fixture.rt, fixture.paths, SLUG, SESSION, process.pid), null)
    first.release()
    const second = claimPickup(fixture.rt, fixture.paths, SLUG, SESSION, process.pid)
    assert.ok(second !== null, 'a released claim must leave the thread claimable')
    second.release()
  })
})
