import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const HANGING_SERVER = 'node -e "process.stdin.resume()"'

const runStep = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
  return result.stdout.trim()
}

const makeRepo = (root: string): string => {
  const repo = join(root, 'local')
  runStep(root, ['init', '--initial-branch=main', 'local'])
  runStep(repo, ['config', 'user.name', 'Logbook Fixture'])
  runStep(repo, ['config', 'user.email', 'fixture@logbook.test'])
  runStep(repo, ['commit', '--allow-empty', '-m', 'fixture: initial commit'])
  return repo
}

const makeClone = (root: string): { local: string; origin: string } => {
  const origin = join(root, 'origin.git')
  runStep(root, ['init', '--bare', '--initial-branch=main', 'origin.git'])
  const local = makeRepo(root)
  runStep(local, ['update-ref', 'refs/logbook/threads', 'HEAD'])
  runStep(local, ['remote', 'add', 'origin', origin])
  return { local, origin }
}

const runtimeFor = (home: string): Runtime => testRuntime({ env: { PATH: process.env.PATH, HOME: home } })

const uniqueToken = (): string => randomBytes(8).toString('hex')

const processesMatching = (token: string): string => spawnSync('pgrep', ['-fl', token], { encoding: 'utf8' }).stdout

test('git.timed-run-returns-the-result-when-git-finishes-in-time', async () => {
  const { gitTimed } = await import('../../src/store/git.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-runner-options-'))
  try {
    const repo = makeRepo(root)
    const head = runStep(repo, ['rev-parse', 'HEAD'])

    const run = await gitTimed(runtimeFor(root), repo, ['rev-parse', 'HEAD'], { timeoutMs: 10000 })

    assert.equal(run.code, 0, `git rev-parse HEAD must exit 0, got stderr: ${run.stderr}`)
    assert.equal(run.stdout, `${head}\n`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('git.timed-run-kills-a-hung-fetch-and-everything-it-started', async () => {
  const { gitTimed } = await import('../../src/store/git.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-runner-options-'))
  try {
    const { local } = makeClone(root)
    const token = uniqueToken()
    runStep(local, ['config', 'remote.origin.uploadpack', `${HANGING_SERVER} ${token}`])

    const run = await gitTimed(runtimeFor(root), local, ['fetch', 'origin'], { timeoutMs: 500 })

    assert.deepEqual(run, { code: -1, stdout: '', stderr: 'git fetch timed out after 500 ms' })
    assert.equal(processesMatching(token), '', 'no process running process.stdin.resume() may remain after the call resolves')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('git.background-push-returns-before-it-ends', async () => {
  const { startBackgroundPush } = await import('../../src/store/git.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-runner-options-'))
  try {
    const { local, origin } = makeClone(root)
    const localCommit = runStep(local, ['rev-parse', 'refs/logbook/threads'])

    const child = startBackgroundPush(runtimeFor(root), local, 15000)
    const exited = once(child, 'exit')

    assert.equal(typeof child.pid, 'number', 'the returned child must have a pid')
    assert.equal(child.exitCode, null, 'the child must not have exited when it is returned')
    const [code] = await exited
    assert.equal(code, 0)
    assert.equal(runStep(origin, ['rev-parse', 'refs/logbook/threads']), localCommit)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('git.background-push-stops-when-origin-never-answers', async () => {
  const { startBackgroundPush } = await import('../../src/store/git.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-runner-options-'))
  try {
    const { local } = makeClone(root)
    const token = uniqueToken()
    runStep(local, ['config', 'remote.origin.receivepack', `${HANGING_SERVER} ${token}`])

    const child = startBackgroundPush(runtimeFor(root), local, 500)
    const [code] = await once(child, 'exit')

    assert.equal(code, 1)
    assert.equal(processesMatching(token), '', 'no process running process.stdin.resume() may remain after the push child exits')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
