import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rawGit } from '../../support/git-fixture.ts'

const HELPER = fileURLToPath(new URL('../../../bin/logbook-push.ts', import.meta.url))
const THREADS_REF = 'refs/logbook/threads'
const SPAWN_LIMIT_MS = 120000

type Scratch = { repo: string; origin: string; home: string }

type HelperRun = { status: number | null; stderr: string }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const withThreadsAndOrigin = (fn: (scratch: Scratch) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-push-helper-'))
  try {
    const repo = join(root, 'repo')
    const origin = join(root, 'origin.git')
    const home = join(root, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Push Tester'])
    mustGit(repo, ['config', 'user.email', 'push@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'push helper repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '--quiet', '-m', 'initial commit'])
    mustGit(repo, ['update-ref', THREADS_REF, 'HEAD'])
    mustGit(root, ['init', '--quiet', '--bare', origin])
    mustGit(repo, ['remote', 'add', 'origin', origin])
    fn({ repo, origin, home })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const runHelper = (args: readonly string[], cwd: string, home: string): HelperRun => {
  const result = spawnSync(process.execPath, [HELPER, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      CLAUDE_CODE_SESSION_ID: 'push-helper-test'
    },
    encoding: 'utf8',
    timeout: SPAWN_LIMIT_MS
  })
  return { status: result.status, stderr: result.stderr ?? '' }
}

const originTip = (origin: string): string | null => {
  const result = rawGit(origin, ['rev-parse', '--verify', '--quiet', THREADS_REF])
  return result.status === 0 ? result.stdout.trim() : null
}

test('push-helper.pushes-the-threads-ref-of-the-named-repository-to-origin', () => {
  withThreadsAndOrigin(({ repo, origin, home }) => {
    const run = runHelper([repo], home, home)
    assert.equal(run.status, 0, `the helper must exit 0: ${run.stderr}`)
    assert.equal(originTip(origin), mustGit(repo, ['rev-parse', THREADS_REF]).trim())
  })
})

test('push-helper.exits-1-and-pushes-nothing-for-an-empty-repository-argument', () => {
  withThreadsAndOrigin(({ repo, origin, home }) => {
    const run = runHelper([''], repo, home)
    assert.equal(run.status, 1, `an empty repository argument must exit 1: ${run.stderr}`)
    assert.equal(originTip(origin), null)
  })
})

test('push-helper.exits-1-and-pushes-nothing-without-a-repository-argument', () => {
  withThreadsAndOrigin(({ repo, origin, home }) => {
    const run = runHelper([], repo, home)
    assert.equal(run.status, 1, `a missing repository argument must exit 1: ${run.stderr}`)
    assert.equal(originTip(origin), null)
  })
})
