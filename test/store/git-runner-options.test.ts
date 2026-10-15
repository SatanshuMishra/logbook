import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

const writeScript = (root: string, name: string, lines: string[]): string => {
  const file = join(root, name)
  writeFileSync(file, `${lines.join('\n')}\n`)
  chmodSync(file, 0o755)
  return file
}

const holderLauncher = (pidFile: string): string[] => [
  "const { spawn } = require('node:child_process')",
  "const { writeFileSync } = require('node:fs')",
  "const holder = spawn('sleep', ['6'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] })",
  `writeFileSync(${JSON.stringify(pidFile)}, String(holder.pid))`,
  'holder.unref()'
]

const killHolder = (pidFile: string): void => {
  if (!existsSync(pidFile)) return
  try {
    process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 'SIGKILL')
  } catch {
    return
  }
}

const recorderScript = (root: string, log: string): string =>
  writeScript(root, 'record-upload-pack.sh', ['#!/bin/sh', `echo started >> ${shellQuote(log)}`, 'exit 1'])

const recordedStarts = (log: string): string => (existsSync(log) ? readFileSync(log, 'utf8') : '')

const makePartialClone = (root: string): { clone: string; firstBlob: string } => {
  const { local, origin } = makeClone(root)
  runStep(origin, ['config', 'uploadpack.allowFilter', 'true'])
  runStep(local, ['switch', '-c', 'thread-versions'])
  writeFileSync(join(local, 'fix-login.md'), '# fix-login: Fix the login flow\n\nKeep the retry rule.\n')
  runStep(local, ['add', 'fix-login.md'])
  runStep(local, ['commit', '-m', 'first version'])
  const firstBlob = runStep(local, ['rev-parse', 'HEAD:fix-login.md'])
  writeFileSync(join(local, 'fix-login.md'), '# fix-login: Fix the login flow\n\nThe rule is settled.\n')
  runStep(local, ['commit', '-am', 'second version'])
  runStep(local, ['push', 'origin', 'main', 'refs/heads/thread-versions:refs/logbook/threads'])
  runStep(root, ['clone', '--filter=blob:none', `file://${origin}`, 'partial'])
  const clone = join(root, 'partial')
  runStep(clone, ['fetch', 'origin', '+refs/logbook/threads:refs/logbook/threads'])
  return { clone, firstBlob }
}

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

test('git.timed-run-returns-at-the-timeout-while-a-detached-process-holds-its-output', async () => {
  const { gitTimed } = await import('../../src/store/git.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-runner-options-'))
  const pidFile = join(root, 'holder.pid')
  try {
    const { local } = makeClone(root)
    const server = writeScript(root, 'hold-and-hang.cjs', [...holderLauncher(pidFile), 'process.stdin.resume()'])
    runStep(local, ['config', 'remote.origin.uploadpack', `${shellQuote(process.execPath)} ${shellQuote(server)}`])

    const started = performance.now()
    const run = await gitTimed(runtimeFor(root), local, ['fetch', 'origin'], { timeoutMs: 500 })
    const elapsed = performance.now() - started

    assert.ok(elapsed < 2000, `gitTimed must resolve less than 2000 ms after it started, took ${elapsed} ms`)
    assert.deepEqual(run, { code: -1, stdout: '', stderr: 'git fetch timed out after 500 ms' })
  } finally {
    killHolder(pidFile)
    rmSync(root, { recursive: true, force: true })
  }
})

test('git.timed-run-returns-when-git-exits-while-a-detached-process-holds-its-output', async () => {
  const { gitTimed } = await import('../../src/store/git.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-runner-options-'))
  const pidFile = join(root, 'holder.pid')
  try {
    const origin = join(root, 'origin.git')
    runStep(root, ['init', '--bare', '--initial-branch=main', 'origin.git'])
    const local = makeRepo(root)
    runStep(local, ['remote', 'add', 'origin', origin])
    const launcher = writeScript(root, 'start-holder.cjs', holderLauncher(pidFile))
    const server = writeScript(root, 'hold-then-serve.sh', [
      '#!/bin/sh',
      `${shellQuote(process.execPath)} ${shellQuote(launcher)} < /dev/null > /dev/null`,
      'git upload-pack "$@"'
    ])
    runStep(local, ['config', 'remote.origin.uploadpack', shellQuote(server)])

    const started = performance.now()
    const run = await gitTimed(
      runtimeFor(root),
      local,
      ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', '+refs/logbook/threads:refs/logbook/remotes/origin/threads'],
      { timeoutMs: 5000 }
    )
    const elapsed = performance.now() - started

    assert.ok(elapsed < 2000, `gitTimed must resolve less than 2000 ms after it started, took ${elapsed} ms`)
    assert.notEqual(run.code, 0)
    assert.notEqual(run.code, -1)
    assert.ok(
      run.stderr.includes("couldn't find remote ref refs/logbook/threads"),
      `stderr must hold git's untranslated message, got: ${run.stderr}`
    )
  } finally {
    killHolder(pidFile)
    rmSync(root, { recursive: true, force: true })
  }
})

test('git.never-fetches-a-missing-object', async () => {
  const { git, gitBuffer, gitRun, gitTimed } = await import('../../src/store/git.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-runner-options-'))
  try {
    const { clone, firstBlob } = makePartialClone(root)
    const missing = runStep(clone, ['rev-list', '--objects', '--missing=print', 'refs/logbook/threads'])
    assert.ok(
      missing.split('\n').includes(`?${firstBlob}`),
      'the first version of fix-login.md must be missing from the partial clone'
    )
    const log = join(root, 'upload-pack-starts.log')
    runStep(clone, ['config', 'remote.origin.uploadpack', shellQuote(recorderScript(root, log))])
    const rt = runtimeFor(root)
    const args = ['cat-file', '-p', firstBlob]

    const plain = git(rt, clone, args)
    const run = gitRun(rt, clone, args)
    const buffered = gitBuffer(rt, clone, args)
    const timed = await gitTimed(rt, clone, args, { timeoutMs: 5000 })

    assert.equal(plain.ok, false)
    assert.notEqual(run.code, 0)
    assert.equal(buffered.ok, false)
    assert.notEqual(timed.code, 0)
    assert.equal(recordedStarts(log), '', 'no git run may start the origin upload-pack to fetch a missing object')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
