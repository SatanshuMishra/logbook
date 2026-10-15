import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rawGit } from '../support/git-fixture.ts'

const withLiveRepo = async (fn: (repo: string) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-hook-io-repo-'))
  try {
    const init = rawGit(repo, ['init', '--initial-branch=main'])
    assert.equal(init.status, 0, init.stderr)
    await fn(repo)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

test('hook-io.writes-long-output-whole', async () => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  await withLiveRepo(async (repo) => {
    const run = await runHookProcess({ hook: 'io-probe', event: { session_id: 's1', cwd: repo, size: 20000 } })
    assert.equal(run.code, 0, run.stderr)
    const output = JSON.parse(run.stdout)
    assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.equal(output.hookSpecificOutput.additionalContext.length, 20000)
    assert.equal(output.hookSpecificOutput.additionalContext, 'x'.repeat(20000))
  })
})

test('hook-io.reports-a-thrown-error', async () => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  await withLiveRepo(async (repo) => {
    const run = await runHookProcess({ hook: 'io-probe', event: { session_id: 's1', cwd: repo, throw: 'boom' } })
    assert.equal(run.code, 1)
    assert.ok(run.stderr.includes('io-probe failed: boom'), `stderr was ${JSON.stringify(run.stderr)}`)
    assert.equal(run.stdout, '')
  })
})

test('hook-io.reports-stdin-that-is-not-json', async () => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook: 'io-probe', event: '{not json' })
  assert.equal(run.code, 1)
  assert.ok(run.stderr.startsWith('io-probe failed:'), `stderr was ${JSON.stringify(run.stderr)}`)
  assert.equal(run.stdout, '')
})

test('hook-io.event-without-session-or-cwd-gives-nothing', async () => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const empty = await runHookProcess({ hook: 'io-probe', event: {} })
  assert.equal(empty.code, 0, empty.stderr)
  assert.equal(empty.stdout, '{}')
  assert.deepEqual(JSON.parse(empty.stdout), {})
  const sessionOnly = await runHookProcess({ hook: 'io-probe', event: { session_id: 's1' } })
  assert.equal(sessionOnly.code, 0, sessionOnly.stderr)
  assert.equal(sessionOnly.stdout, '{}')
  assert.deepEqual(JSON.parse(sessionOnly.stdout), {})
})

test('hook-io.event-outside-a-repository-gives-nothing', async () => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const outside = mkdtempSync(join(tmpdir(), 'logbook-hook-io-outside-'))
  try {
    const run = await runHookProcess({ hook: 'io-probe', event: { session_id: 's1', cwd: outside } })
    assert.equal(run.code, 0, run.stderr)
    assert.equal(run.stdout, '{}')
    assert.deepEqual(JSON.parse(run.stdout), {})
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('hook-io.project-dir-wins-over-the-event-cwd', async () => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  await withLiveRepo(async (root) => {
    const nested = rawGit(root, ['init', '--initial-branch=main', 'sub'])
    assert.equal(nested.status, 0, nested.stderr)
    const run = await runHookProcess({
      hook: 'io-probe',
      event: { session_id: 's1', cwd: join(root, 'sub'), echo: 'root' },
      env: { CLAUDE_PROJECT_DIR: root }
    })
    assert.equal(run.code, 0, run.stderr)
    const output = JSON.parse(run.stdout)
    assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.equal(realpathSync(output.hookSpecificOutput.additionalContext), realpathSync(root))
  })
})
