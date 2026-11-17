import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionStart } from '../../src/hook/session-start.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { readHold } from '../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime }

const SESSION = 'S'
const OTHERS_HEADING = 'Other open threads, which this session does not hold; switch to one before recording in it:'
const CONTEXT_CEILING = 9500
const STORED_AT = '2026-11-17T09:00:00.000Z'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (slug: string, nextStep: string, stands = `Nothing of ${slug} is built yet.`): string =>
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
    stands,
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
  const root = mkdtempSync(join(tmpdir(), 'logbook-startup-others-'))
  try {
    const repo = join(root, 'repo')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'Others Tester'])
    mustGit(repo, ['config', 'user.email', 'others@logbook.test'])
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

test('startup-others.document-of-another-open-thread-is-in-the-context', () => {
  withFixture((fixture) => {
    const older = stateDocument('older-work', 'Write the older tests.')
    const newer = stateDocument('newer-work', 'Ship the newer feature.')
    openThread(fixture, 'older-work', older)
    openThread(fixture, 'newer-work', newer)
    const context = startup(fixture)
    const others = context.indexOf(OTHERS_HEADING)
    assert.notEqual(others, -1, context)
    assert.ok(context.indexOf(older.trimEnd(), others) > others, context)
    assert.ok(context.indexOf(newer.trimEnd()) < others, context)
    assert.equal(readHold(fixture.paths, 'older-work'), null)
  })
})

test('startup-others.documents-are-left-out-before-the-roster-when-the-context-is-full', () => {
  withFixture((fixture) => {
    const long = 'The older work has a long history. '.repeat(260).trim()
    const older = stateDocument('older-work', 'Write the older tests.', long)
    openThread(fixture, 'older-work', older)
    openThread(fixture, 'newer-work', stateDocument('newer-work', 'Ship the newer feature.'))
    const context = startup(fixture)
    assert.ok(context.length <= CONTEXT_CEILING, `the context is ${context.length} characters`)
    assert.equal(context.includes(OTHERS_HEADING), false, context)
    assert.equal(context.includes(long), false)
    assert.ok(context.includes('older-work - active - Next: Write the older tests.'), context)
  })
})
