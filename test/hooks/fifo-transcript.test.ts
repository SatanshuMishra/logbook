import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildActivity } from '../../src/thread/activity.ts'
import { readHold, takeHold } from '../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; fifo: string }

const SLUG = 'work'
const SESSION = 's1'
const HOOK_EVENT_ENTRY = fileURLToPath(new URL('./fixtures/hook-event.ts', import.meta.url))
const HANG_LIMIT_MS = 10_000

const workDocument = (): string =>
  [
    '# work: Finish the work',
    'Status: active',
    `Updated: ${new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    'The work is finished.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The work ships',
    '',
    '## Where things stand',
    '',
    'Nothing is built yet.',
    '',
    '## Next step',
    '',
    'Start the work.',
    '',
    '## Decisions in force',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    ''
  ].join('\n') + '\n'

const mustRun = (command: string, args: string[], cwd: string): void => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr}`)
}

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const withFifoTranscript = (fn: (fixture: Fixture) => void): void => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-fifo-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-fifo-home-'))
  try {
    mustGit(repo, ['init', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
    mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
    const rt = testRuntime({
      start: new Date().toISOString(),
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: home },
      sessionId: SESSION
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: SLUG, text: workDocument(), expectedBlob: null }],
      message: 'open_thread work: opened'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
    takeHold(rt, found.value, SLUG, SESSION, null)
    const transcripts = join(home, 'transcripts')
    mkdirSync(transcripts, { recursive: true })
    const fifo = join(transcripts, `${SESSION}.jsonl`)
    mustRun('mkfifo', [fifo], home)
    fn({ repo, home, paths: found.value, fifo })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

test('fifo-transcript.activity-skips-a-transcript-that-is-not-a-regular-file', () => {
  withFifoTranscript(({ fifo, home }) => {
    const run = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { buildActivity } from ${JSON.stringify(new URL('../../src/thread/activity.ts', import.meta.url).href)}
const activity = buildActivity({ transcripts: [${JSON.stringify(fifo)}], since: null, workingCopyPath: '/nowhere' })
process.stdout.write(JSON.stringify(activity))`
      ],
      { encoding: 'utf8', timeout: HANG_LIMIT_MS, env: { PATH: process.env.PATH ?? '', HOME: home } }
    )
    assert.equal(run.signal, null, 'reading a FIFO transcript must not block')
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), buildActivity({ transcripts: [], since: null, workingCopyPath: '/nowhere' }))
  })
})

test('fifo-transcript.stop-answers-when-the-hold-names-a-fifo', () => {
  withFifoTranscript(({ repo, home, paths, fifo }) => {
    const event = {
      hook_event_name: 'Stop',
      session_id: SESSION,
      cwd: repo,
      transcript_path: fifo,
      stop_hook_active: false
    }
    const run = spawnSync(process.execPath, [HOOK_EVENT_ENTRY], {
      input: JSON.stringify(event),
      encoding: 'utf8',
      timeout: HANG_LIMIT_MS,
      env: { PATH: process.env.PATH ?? '', HOME: home, CLAUDE_CODE_SESSION_ID: SESSION }
    })
    assert.equal(run.signal, null, 'a Stop whose hold names a FIFO transcript must answer')
    assert.equal(run.status, 0, run.stderr)
    assert.ok(readHold(paths, SLUG)?.transcripts.includes(fifo), 'the Stop must have read the hold that names the FIFO')
  })
})
