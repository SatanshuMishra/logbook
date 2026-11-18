import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { runTool } from '../../../src/server/register.ts'
import { parkThreadTool } from '../../../src/server/tools/park_thread.ts'
import { takeHold } from '../../../src/thread/holds.ts'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const THREADS = 'refs/logbook/threads'
const START = '2026-11-17T09:00:00.000Z'
const SESSION = 'session-s'

type Fixture = { repo: string; origin: string; rt: Runtime }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const fixLogin = (): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${START}`,
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

const withHeldThread = async (
  makeOrigin: (scratch: string) => string,
  fn: (fixture: Fixture) => Promise<void>
): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-park-push-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Park Push Tester'])
    mustGit(repo, ['config', 'user.email', 'park-push@logbook.test'])
    const origin = makeOrigin(scratch)
    mustGit(repo, ['remote', 'add', 'origin', origin])
    const rt = testRuntime({
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: home, PLUGIN_METRICS_DIR: join(scratch, 'metrics') },
      sessionId: SESSION,
      start: START
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: fixLogin(), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, JSON.stringify(seeded))
    takeHold(rt, found.value, 'fix-login', SESSION, null)
    await fn({ repo, origin, rt })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const bareOrigin = (scratch: string): string => {
  const origin = join(scratch, 'origin.git')
  mustGit(scratch, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  return origin
}

const emptyFolder = (scratch: string): string => {
  const nowhere = join(scratch, 'no-repository-here')
  mkdirSync(nowhere)
  return nowhere
}

const statusIn = (repo: string, ref: string): string | undefined =>
  mustGit(repo, ['cat-file', 'blob', `${ref}:fix-login.md`])
    .split('\n')
    .find((line) => line.startsWith('Status: '))

test('park-push.origin-has-the-park-when-it-replies', async () => {
  await withHeldThread(bareOrigin, async ({ repo, origin, rt }) => {
    const outcome = await runTool(rt, parkThreadTool, { thread_id: 'fix-login' })

    assert.equal(outcome.kind, 'ok', JSON.stringify(outcome))
    if (outcome.kind !== 'ok') return
    const localTip = mustGit(repo, ['rev-parse', THREADS]).trim()
    assert.equal(mustGit(origin, ['rev-parse', THREADS]).trim(), localTip)
    assert.equal(statusIn(origin, THREADS), 'Status: parked')
    assert.equal(outcome.structured.pushed, true)
    assert.equal(outcome.structured.push_error, null)
    assert.ok(outcome.text.split('\n').includes('Origin has the parked thread.'), outcome.text)
  })
})

test('park-push.failed-push-is-reported', async () => {
  await withHeldThread(emptyFolder, async ({ repo, rt }) => {
    const outcome = await runTool(rt, parkThreadTool, { thread_id: 'fix-login' })

    assert.equal(outcome.kind, 'ok', JSON.stringify(outcome))
    if (outcome.kind !== 'ok') return
    assert.equal(statusIn(repo, THREADS), 'Status: parked')
    assert.equal(outcome.structured.pushed, false)
    assert.match(outcome.structured.push_error ?? '', /does not appear to be a git repository/)
    assert.match(outcome.text, /The push to origin failed: .*does not appear to be a git repository/)
    assert.ok(outcome.text.includes('will be pushed at the next session start or sync.'), outcome.text)
  })
})
