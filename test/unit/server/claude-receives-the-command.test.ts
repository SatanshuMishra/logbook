import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionStart } from '../../../src/hook/session-start.ts'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { runTool } from '../../../src/server/register.ts'
import { openThreadTool } from '../../../src/server/tools/open_thread.ts'
import { parkThreadTool } from '../../../src/server/tools/park_thread.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

type Fixture = { repo: string; paths: RepoPaths; rt: (sessionId: string) => Runtime }

const SLUG = 'fix-login'
const RECORD_COMMAND = 'logbook update_thread --args -'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-claude-receives-'))
  try {
    const repo = join(root, 'repo')
    mustGit(root, ['init', '--quiet', '--initial-branch=main', repo])
    mustGit(repo, ['config', 'user.name', 'Reply Tester'])
    mustGit(repo, ['config', 'user.email', 'reply@logbook.test'])
    mustGit(repo, ['commit', '--quiet', '--allow-empty', '-m', 'initial commit'])
    const env = {
      PATH: process.env.PATH,
      HOME: join(root, 'home'),
      PLUGIN_METRICS_DIR: join(root, 'metrics'),
      CLAUDE_PID: String(process.pid)
    }
    const rt = (sessionId: string): Runtime => testRuntime({ cwd: repo, env, sessionId })
    const found = findRepository(rt('setup'), repo)
    assert.ok(found.ok, 'the test repository must be found')
    await fn({ repo, paths: found.value, rt })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const openFixLogin = async (fixture: Fixture, sessionId: string): Promise<Record<string, unknown>> => {
  const opened = await runTool(fixture.rt(sessionId), openThreadTool, {
    slug: SLUG,
    title: 'Fix login',
    goal: 'Login works',
    next_step: 'Write the test.'
  })
  assert.equal(opened.kind, 'ok', JSON.stringify(opened))
  assert.ok(opened.kind === 'ok' && isRecord(opened.structured), JSON.stringify(opened))
  return opened.structured
}

const startupContext = (fixture: Fixture, sessionId: string): string => {
  const output = sessionStart({
    event: { session_id: sessionId, cwd: fixture.repo, hook_event_name: 'SessionStart', source: 'startup' },
    sessionId,
    paths: fixture.paths,
    rt: fixture.rt(sessionId)
  })
  const specific: unknown = 'hookSpecificOutput' in output ? output.hookSpecificOutput : undefined
  assert.ok(isRecord(specific), `the startup must add context, got ${JSON.stringify(output)}`)
  return String(specific.additionalContext)
}

test('claude-receives-the-command.open-thread-structured-reply-names-the-record-command', async () => {
  await withFixture(async (fixture) => {
    const structured = await openFixLogin(fixture, 'A')

    assert.equal(structured.thread_id, SLUG)
    const keepTrue = structured.keep_true
    assert.equal(typeof keepTrue, 'string', JSON.stringify(structured))
    assert.ok(String(keepTrue).includes(RECORD_COMMAND), String(keepTrue))
    assert.ok(String(keepTrue).includes('chained after git commit'), String(keepTrue))
  })
})

test('claude-receives-the-command.startup-pickup-says-no-resume-call-is-needed', async () => {
  await withFixture(async (fixture) => {
    await openFixLogin(fixture, 'A')
    const parked = await runTool(fixture.rt('A'), parkThreadTool, { thread_id: SLUG })
    assert.equal(parked.kind, 'ok', JSON.stringify(parked))

    const context = startupContext(fixture, 'B')
    const opening = context.split('\n\n')[0] ?? ''

    assert.ok(
      opening.startsWith(
        `Logbook picked up thread ${SLUG} at session start, the newest open thread no running session holds.`
      ),
      opening
    )
    assert.ok(opening.includes(`This session already holds thread ${SLUG}`), opening)
    assert.ok(opening.includes('no resume_thread call'), opening)
  })
})
