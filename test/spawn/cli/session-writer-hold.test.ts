import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readHold, takeHold } from '../../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const COMMAND = join(fileURLToPath(new URL('../../..', import.meta.url)), 'bin', 'logbook')
const THREADS_REF = 'refs/logbook/threads'
const SPAWN_LIMIT_MS = 120000
const HOLDER = 'sess-1'

const STATE_DOCUMENT = [
  '# fix-login: Fix the login page',
  'Status: active',
  'Updated: 2023-12-31T09:00:00.000Z',
  'Next ids: c2 D1 R1 S1',
  '',
  '## Goal',
  '',
  'Users can log in again.',
  '',
  '## Done when',
  '',
  '- [ ] c1 The login page loads.',
  '',
  '## Where things stand',
  '',
  'The form renders but submitting it fails.',
  '',
  '## Next step',
  '',
  'Find the fault.',
  '',
  '## Decisions in force',
  '',
  '## Open risks',
  '',
  '## Settled, do not reopen',
  '',
  '## Where the details live',
  ''
].join('\n')

type Held = { repo: string; home: string; paths: RepoPaths }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const withHeldThread = (fn: (held: Held) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-session-writer-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Hold Tester'])
    mustGit(repo, ['config', 'user.email', 'hold@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'hold test repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '--quiet', '-m', 'initial commit'])
    const rt = testRuntime({ env: { PATH: process.env.PATH, HOME: home }, sessionId: HOLDER })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the scratch repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: STATE_DOCUMENT, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, `the thread must be seeded: ${JSON.stringify(seeded)}`)
    takeHold(rt, found.value, 'fix-login', HOLDER, null)
    fn({ repo, home, paths: found.value })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const park = (held: Held, writer: string, args: Record<string, unknown>): void => {
  const result = spawnSync(
    COMMAND,
    ['park_thread', '--repo', held.repo, '--writer', writer, '--args', JSON.stringify(args)],
    { cwd: held.home, env: { PATH: process.env.PATH ?? '', HOME: held.home }, encoding: 'utf8', timeout: SPAWN_LIMIT_MS }
  )
  assert.equal(result.status, 0, `exit ${String(result.status)}, stderr ${JSON.stringify(result.stderr)}`)
}

const storedStatusIsParked = (repo: string): boolean =>
  mustGit(repo, ['cat-file', 'blob', `${THREADS_REF}:fix-login.md`]).split('\n').includes('Status: parked')

test('command.session-writer-park-releases-its-hold', () => {
  withHeldThread((held) => {
    park(held, HOLDER, { next_step: 'Resume later.' })
    assert.ok(storedStatusIsParked(held.repo))
    assert.equal(readHold(held.paths, 'fix-login')?.holder, null)
  })
})

test('command.run-writer-park-keeps-the-session-hold', () => {
  withHeldThread((held) => {
    park(held, 'run:demo', { thread_id: 'fix-login', next_step: 'Resume later.' })
    assert.ok(storedStatusIsParked(held.repo))
    assert.equal(readHold(held.paths, 'fix-login')?.holder, HOLDER)
  })
})
