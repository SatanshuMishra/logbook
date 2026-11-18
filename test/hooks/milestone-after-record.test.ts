import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { postToolUse, type PostToolUseOutput } from '../../src/hook/post-tool-use.ts'
import { foldHold, takeHold } from '../../src/thread/holds.ts'
import { writeMarker } from '../../src/thread/inflight.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const SLUG = 'fix-login'
const S = 'session-s'
const T = 'toolu_commit'
const PROVISIONAL_LINE =
  'Logbook picked this thread up at session start; record only work that belongs to thread fix-login.'

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime }

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const fixLogin = (): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
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

const withFixture = async (fn: (fixture: Fixture) => void): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-milestone-record-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Milestone Tester'])
    mustGit(repo, ['config', 'user.email', 'milestone@logbook.test'])
    const rt = testRuntime({
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: home, PLUGIN_METRICS_DIR: join(scratch, 'metrics') },
      sessionId: S
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: SLUG, text: fixLogin(), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, JSON.stringify(seeded))
    fn({ repo, paths: found.value, rt })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const startCall = (fixture: Fixture): void => {
  const written = writeMarker(fixture.rt, fixture.paths, SLUG, {
    toolUseId: T,
    tool: 'Bash',
    toolInput: { command: 'git commit -m done' },
    session: S
  })
  assert.ok(written, 'the in-flight marker must be written')
}

const runPostToolUse = (fixture: Fixture, command: string): PostToolUseOutput =>
  postToolUse({
    event: {
      session_id: S,
      cwd: fixture.repo,
      prompt_id: 'p1',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { stdout: 'ok' },
      tool_use_id: T
    },
    sessionId: S,
    paths: fixture.paths,
    rt: fixture.rt
  })

const contextOf = (output: PostToolUseOutput): string | undefined =>
  'hookSpecificOutput' in output ? output.hookSpecificOutput.additionalContext : undefined

test('milestone-after-record.commit-that-recorded-gets-no-request', async () => {
  await withFixture((fixture) => {
    takeHold(fixture.rt, fixture.paths, SLUG, S, null)
    startCall(fixture)
    foldHold(fixture.rt, fixture.paths, SLUG, fixture.rt.now())
    const output = runPostToolUse(fixture, 'git commit -m done && logbook update_thread --args -')
    assert.equal(contextOf(output), undefined)
  })
})

test('milestone-after-record.provisional-request-limits-what-to-record', async () => {
  await withFixture((fixture) => {
    takeHold(fixture.rt, fixture.paths, SLUG, S, null, null, { provisional: true })
    startCall(fixture)
    const context = contextOf(runPostToolUse(fixture, 'git commit -m done'))
    assert.equal(typeof context, 'string', 'a milestone with no write must make an update request')
    assert.ok(context?.split('\n').includes(PROVISIONAL_LINE), context)
  })
})
