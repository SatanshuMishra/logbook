import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { StoreLayout } from '../../src/store/layout.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { openStore } from '../../src/store/records.ts'
import { runSessionStart } from '../../src/cli/session-start.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { testRuntime } from './runtime.ts'
import { rawGit } from './git-fixture.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

export const setupFixtureRepo = (repo: string): void => {
  const steps: string[][] = [
    ['init', '--initial-branch=main'],
    ['config', 'user.name', 'Logbook Fixture'],
    ['config', 'user.email', 'fixture@logbook.test']
  ]
  for (const args of steps) {
    const result = rawGit(repo, args)
    assert.equal(result.status, 0, `fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  const added = rawGit(repo, ['add', 'README.md'])
  assert.equal(added.status, 0, `fixture setup failed: git add README.md: ${added.stderr}`)
  const committed = rawGit(repo, ['commit', '-m', 'fixture: initial commit'])
  assert.equal(committed.status, 0, `fixture setup failed: git commit: ${committed.stderr}`)
}

export const makeThread = (rt: Runtime, slug: string, id?: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: id ?? rt.ulid(),
    slug,
    title: 'a stop gate presence thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      landed: '',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

export type Fixture = { rt: Runtime; repo: string; layout: StoreLayout }

export const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-presence-plugin-data-'))
  const repo = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-presence-repo-'))
  try {
    setupFixtureRepo(repo)
    const pluginData = join(home, 'plugin-data')
    mkdirSync(pluginData)
    const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
    const layout = layoutFor(rt, repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return
    await fn({ rt, repo, layout: layout.value })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

export const commitOneThread = (rt: Runtime, repo: string, slug: string): string => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const change = makeThread(rt, slug)
  const committed = opened.value.commit([change], `seed ${slug}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
  return change.record.id
}

export const commitToThread = (rt: Runtime, repo: string, threadId: string, slug: string): void => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const change = makeThread(rt, slug, threadId)
  const committed = opened.value.commit([change], `seed ${slug}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
}

const makeSessionEntry = (rt: Runtime, threadId: string, body: string): Extract<RecordChange, { kind: 'session' }> => ({
  kind: 'session',
  record: {
    id: rt.ulid(),
    thread_id: threadId,
    actor: 'stop-gate-presence-fixture',
    body,
    created_at: rt.now()
  }
})

export const commitSessionEntry = (rt: Runtime, repo: string, threadId: string, body: string): void => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const change = makeSessionEntry(rt, threadId, body)
  const committed = opened.value.commit([change], `seed session entry for ${threadId}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
}

export const startSession = (rt: Runtime, repo: string, sessionId: string): void => {
  runSessionStart(rt, { session_id: sessionId, source: 'startup', cwd: repo })
}

export const resumeAs = async (rt: Runtime, sessionId: string, threadId: string): Promise<void> => {
  const resumeRt: Runtime = { ...rt, sessionId }
  const reply = await resumeThreadTool.handler(resumeRt, STUB_TOOL_CTX, { thread_id: threadId })
  assert.equal(reply.ok, true, 'resume_thread must succeed for the fixture to establish a resume baseline')
}

export const stopEventFor = (
  repo: string,
  sessionId: string,
  stopHookActive: boolean,
  promptId: string | null = null
) => ({
  session_id: sessionId,
  cwd: repo,
  transcript_path: join(repo, 'no-such-transcript.jsonl'),
  stop_hook_active: stopHookActive,
  prompt_id: promptId
})

export const subagentEventFor = (
  repo: string,
  sessionId: string,
  agentId: string | null,
  agentType: string = 'Explore'
) => ({
  session_id: sessionId,
  cwd: repo,
  agent_id: agentId,
  agent_type: agentType
})
