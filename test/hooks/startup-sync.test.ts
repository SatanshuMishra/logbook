import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSessionStart } from '../../src/hook/session-start.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments, readDocument } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { root: string; repo: string; paths: RepoPaths; rt: Runtime }

const SESSION = 'S'
const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = '2026-11-17T09:00:00.000Z'
const COULD_NOT_SYNC = 'Logbook could not sync threads with origin'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (status: string, nextStep: string): string =>
  [
    '# fix-login: Fix the login page',
    `Status: ${status}`,
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
    nextStep,
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

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-startup-sync-'))
  try {
    const repo = join(root, 'repo')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'Sync Tester'])
    mustGit(repo, ['config', 'user.email', 'sync@logbook.test'])
    mustGit(repo, ['commit', '--quiet', '--allow-empty', '-m', 'initial commit'])
    const rt = testRuntime({
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: join(root, 'home'), PLUGIN_METRICS_DIR: join(root, 'metrics') },
      sessionId: SESSION
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    await fn({ root, repo, paths: found.value, rt })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const commitThread = (fixture: Fixture, text: string, message: string): void => {
  const stored = readDocument(fixture.rt, fixture.paths, 'fix-login')
  const committed = commitDocuments(fixture.rt, fixture.paths, {
    changes: [{ slug: 'fix-login', text, expectedBlob: stored?.blob ?? null }],
    message
  })
  assert.ok(committed.ok, `fix-login must be committed: ${JSON.stringify(committed)}`)
}

const startupContext = async (fixture: Fixture): Promise<string> => {
  const output = await runSessionStart({
    event: { session_id: SESSION, cwd: fixture.repo, hook_event_name: 'SessionStart', source: 'startup' },
    sessionId: SESSION,
    paths: fixture.paths,
    rt: fixture.rt
  })
  const specific: unknown = 'hookSpecificOutput' in output ? output.hookSpecificOutput : undefined
  assert.ok(isRecord(specific), `the startup must add context, got ${JSON.stringify(output)}`)
  return String(specific.additionalContext)
}

test('startup-sync.unpushed-change-is-pushed-at-startup', async () => {
  await withFixture(async (fixture) => {
    const origin = join(fixture.root, 'origin.git')
    mustGit(fixture.root, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
    mustGit(fixture.repo, ['remote', 'add', 'origin', origin])
    commitThread(fixture, stateDocument('active', 'Fix the submit handler.'), 'open_thread fix-login: opened')
    mustGit(fixture.repo, ['push', '--quiet', 'origin', `${THREADS_REF}:${THREADS_REF}`])
    commitThread(fixture, stateDocument('parked', 'Rerun the login tests.'), 'park_thread fix-login: parked')
    const localTip = mustGit(fixture.repo, ['rev-parse', THREADS_REF])
    assert.notEqual(mustGit(origin, ['rev-parse', THREADS_REF]), localTip)
    const context = await startupContext(fixture)
    assert.equal(mustGit(origin, ['rev-parse', THREADS_REF]), localTip)
    assert.equal(context.includes(COULD_NOT_SYNC), false, context)
  })
})

test('startup-sync.unreachable-origin-is-named', async () => {
  await withFixture(async (fixture) => {
    mustGit(fixture.repo, ['remote', 'add', 'origin', join(fixture.root, 'no-repository-here')])
    const parked = stateDocument('parked', 'Fix the submit handler.')
    commitThread(fixture, parked, 'park_thread fix-login: parked')
    const context = await startupContext(fixture)
    assert.ok(context.includes(parked.trimEnd()), context)
    const warning = context.split('\n').find((line) => line.startsWith(`${COULD_NOT_SYNC}: `))
    assert.ok(warning !== undefined, context)
    assert.match(warning, /does not appear to be a git repository/)
    assert.ok(warning.endsWith('This copy may be behind origin.'), warning)
    assert.equal(context.includes('was not parked after its last change'), false, context)
  })
})

test('startup-sync.unparked-thread-says-so', async () => {
  await withFixture(async (fixture) => {
    commitThread(fixture, stateDocument('active', 'Fix the submit handler.'), 'open_thread fix-login: opened')
    const context = await startupContext(fixture)
    assert.ok(
      context
        .split('\n')
        .includes(
          'Thread fix-login was not parked after its last change: the session that last worked on it may not have recorded its latest changes, or they may not have reached origin.'
        ),
      context
    )
    assert.equal(context.includes(COULD_NOT_SYNC), false, context)
  })
})
