import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionStart } from '../../src/hook/session-start.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { heldBy, readHold, takeHold } from '../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime }

const SESSION = 'S'
const RUNNING_SESSION = 'R'
const STORED_AT = '2026-11-17T09:00:00.000Z'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (slug: string, nextStep: string): string =>
  [
    `# ${slug}: Work on ${slug}`,
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    `The ${slug} work is finished.`,
    '',
    '## Done when',
    '',
    `- [ ] c1 The ${slug} work ships`,
    '',
    '## Where things stand',
    '',
    `Nothing of ${slug} is built yet.`,
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
    `- Spec: docs/specs/${slug}.md`,
    ''
  ].join('\n')

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const withFixture = (fn: (fixture: Fixture) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-startup-pickup-'))
  try {
    const repo = join(root, 'repo')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'Pickup Tester'])
    mustGit(repo, ['config', 'user.email', 'pickup@logbook.test'])
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
    fn({ repo, paths: found.value, rt })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const openThread = (fixture: Fixture, slug: string, text: string): void => {
  const committed = commitDocuments(fixture.rt, fixture.paths, {
    changes: [{ slug, text, expectedBlob: null }],
    message: `open_thread ${slug}: opened`
  })
  assert.ok(committed.ok, `thread ${slug} must be committed: ${JSON.stringify(committed)}`)
}

const startup = (fixture: Fixture): string => {
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

const linesStarting = (context: string, prefix: string): string[] =>
  context.split('\n').filter((line) => line.startsWith(prefix))

test('startup-pickup.newest-open-thread-is-picked-up', () => {
  withFixture((fixture) => {
    const older = stateDocument('older-work', 'Write the older tests.')
    const newer = stateDocument('newer-work', 'Ship the newer feature.')
    openThread(fixture, 'older-work', older)
    openThread(fixture, 'newer-work', newer)
    const context = startup(fixture)
    assert.ok(
      context.startsWith(
        'Logbook picked up thread newer-work at session start, the newest open thread no running session holds.'
      ),
      context
    )
    assert.ok(context.includes(newer.trimEnd()), context)
    assert.ok(context.split('\n').includes("logbook update_thread --args - <<'EOF'"), context)
    assert.deepEqual(linesStarting(context, 'older-work - '), ['older-work - active - Next: Write the older tests.'])
    assert.deepEqual(linesStarting(context, 'newer-work - '), [])
    const hold = readHold(fixture.paths, 'newer-work')
    assert.equal(hold?.holder, SESSION)
    assert.equal(hold?.provisional, true)
    assert.equal(hold?.process, process.pid)
    assert.deepEqual(hold?.transcripts, [])
    assert.equal(readHold(fixture.paths, 'older-work'), null)
  })
})

test('startup-pickup.thread-held-by-a-running-session-is-left', () => {
  withFixture((fixture) => {
    const document = stateDocument('fix-login', 'Fix the submit handler.')
    openThread(fixture, 'fix-login', document)
    takeHold(fixture.rt, fixture.paths, 'fix-login', RUNNING_SESSION, null, process.pid)
    const context = startup(fixture)
    assert.ok(context.includes('fix-login - active - Next: Fix the submit handler.'), context)
    assert.equal(context.includes('## Where things stand'), false, context)
    assert.equal(readHold(fixture.paths, 'fix-login')?.holder, RUNNING_SESSION)
    assert.equal(heldBy(fixture.paths, SESSION), null)
  })
})
