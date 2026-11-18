import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { readHold, releaseEndedHolds, takeBackHolds, takeHold } from '../../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const START = '2026-11-17T09:00:00.000Z'
const SLUG = 'fix-login'
const PICKER = 'session-b'
const LATER = 'session-c'

type Fixture = { home: string; paths: RepoPaths; runtimeFor: (session: string) => Runtime }

const withRepository = (fn: (fixture: Fixture) => void): void => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-provisional-release-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    const init = rawGit(repo, ['init', '--quiet', '--initial-branch=main'])
    assert.equal(init.status, 0, init.stderr)
    const runtimeFor = (session: string): Runtime =>
      testRuntime({
        cwd: repo,
        env: { PATH: process.env.PATH, HOME: home, PLUGIN_METRICS_DIR: join(scratch, 'metrics') },
        sessionId: session,
        start: START
      })
    const found = findRepository(runtimeFor(LATER), repo)
    assert.ok(found.ok, 'the test repository must be found')
    fn({ home, paths: found.value, runtimeFor })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const exitedProcess = (home: string): number => {
  const child = spawnSync(process.execPath, ['-e', ''], { env: { HOME: home } })
  assert.equal(child.status, 0, 'the short-lived child process must exit cleanly')
  assert.equal(typeof child.pid, 'number', 'the short-lived child process must have a process id')
  return child.pid as number
}

test('provisional-release.no-earlier-owner-names-no-owner', () => {
  withRepository(({ home, paths, runtimeFor }) => {
    takeHold(runtimeFor(PICKER), paths, SLUG, PICKER, null, exitedProcess(home), { provisional: true })
    const released = releaseEndedHolds(runtimeFor(LATER), paths, LATER)
    assert.deepEqual(
      released.map((hold) => [hold.slug, hold.holder, hold.released_from]),
      [[SLUG, null, null]]
    )
    assert.equal(readHold(paths, SLUG)?.released_from, null)
  })
})

test('provisional-release.picker-does-not-take-the-thread-back', () => {
  withRepository(({ home, paths, runtimeFor }) => {
    takeHold(runtimeFor(PICKER), paths, SLUG, PICKER, null, exitedProcess(home), { provisional: true })
    releaseEndedHolds(runtimeFor(LATER), paths, LATER)
    takeHold(runtimeFor(LATER), paths, SLUG, LATER, null, process.pid, { provisional: true })
    assert.equal(takeBackHolds(runtimeFor(PICKER), paths, PICKER), null)
    assert.equal(readHold(paths, SLUG)?.holder, LATER)
  })
})
