import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRepository } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { runHookProcess } from '../support/run-hook.ts'
import { testRuntime } from '../support/runtime.ts'

type Clone = { repo: string; env: Record<string, string> }

type Run = { status: number | null; stdout: string; stderr: string }

const COMMAND = join(fileURLToPath(new URL('../..', import.meta.url)), 'bin', 'logbook')
const THREADS_REF = 'refs/logbook/threads'
const SPAWN_LIMIT_MS = 120000
const NEXT_STEP = 'Finish the audit log.'

const STATE_DOCUMENT = [
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const cloneOf = (root: string, origin: string, name: string): Clone => {
  const home = join(root, `home-${name}`)
  mkdirSync(home)
  mustGit(root, ['clone', '--quiet', origin, name])
  const repo = join(root, name)
  mustGit(repo, ['config', 'user.name', `Clone ${name}`])
  mustGit(repo, ['config', 'user.email', `${name}@logbook.test`])
  return { repo, env: { PATH: process.env.PATH ?? '', HOME: home, PLUGIN_METRICS_DIR: join(root, `metrics-${name}`) } }
}

const park = (clone: Clone, session: string, args: Record<string, string>): Run => {
  const result = spawnSync(COMMAND, ['park_thread', '--args', '-'], {
    cwd: clone.repo,
    env: { ...clone.env, CLAUDE_CODE_SESSION_ID: session },
    input: JSON.stringify(args),
    encoding: 'utf8',
    timeout: SPAWN_LIMIT_MS
  })
  assert.equal(result.error, undefined, `the command must start: ${String(result.error)}`)
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const startupContext = async (clone: Clone, session: string): Promise<string> => {
  const run = await runHookProcess({
    hook: 'session-start',
    event: { session_id: session, cwd: clone.repo, hook_event_name: 'SessionStart', source: 'startup' },
    env: clone.env
  })
  assert.equal(run.code, 0, run.stderr)
  const output: unknown = JSON.parse(run.stdout)
  assert.ok(isRecord(output) && isRecord(output.hookSpecificOutput), `the startup must add context, got ${run.stdout}`)
  return String(output.hookSpecificOutput.additionalContext)
}

test('two-clone-handoff.fresh-clone-picks-up-a-parked-thread', async () => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-two-clone-'))
  try {
    const origin = join(root, 'origin.git')
    mustGit(root, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
    const a = cloneOf(root, origin, 'a')
    mustGit(a.repo, ['commit', '--quiet', '--allow-empty', '-m', 'initial commit'])
    mustGit(a.repo, ['push', '--quiet', 'origin', 'main'])
    const rt = testRuntime({ cwd: a.repo, env: a.env, sessionId: 'SA' })
    const found = findRepository(rt, a.repo)
    assert.ok(found.ok, 'clone A must be found')
    const opened = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: STATE_DOCUMENT, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(opened.ok, `fix-login must be opened: ${JSON.stringify(opened)}`)
    const parkedInA = park(a, 'SA', { thread_id: 'fix-login' })
    assert.equal(parkedInA.status, 0, parkedInA.stderr)

    const b = cloneOf(root, origin, 'b')
    assert.equal(rawGit(b.repo, ['rev-parse', '--verify', '--quiet', THREADS_REF]).status, 1)
    const parkedDocument = mustGit(origin, ['show', `${THREADS_REF}:fix-login.md`]).trimEnd()
    assert.ok(parkedDocument.includes('Status: parked'), parkedDocument)
    const contextInB = await startupContext(b, 'SB')
    assert.ok(contextInB.includes(parkedDocument), contextInB)

    const parkedInB = park(b, 'SB', { thread_id: 'fix-login', next_step: NEXT_STEP })
    assert.equal(parkedInB.status, 0, parkedInB.stderr)
    const reply: unknown = JSON.parse(parkedInB.stdout.trim().split('\n').at(-1) ?? '')
    assert.ok(isRecord(reply), parkedInB.stdout)
    assert.equal(reply.pushed, true, parkedInB.stdout)

    const contextInA = await startupContext(a, 'SA2')
    assert.ok(contextInA.includes(`## Next step\n\n${NEXT_STEP}`), contextInA)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
