import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Thread } from '../../src/schema/thread.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { openStore } from '../../src/store/records.ts'
import { writePointer } from '../../src/domain/pointer.ts'
import { COMPACT_BRIEFING_HEADING } from '../../src/render/compact-briefing.ts'
import { HOOK_CONTEXT_MAX_CODE_UNITS } from '../../src/render/clip.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { controlledEnv, freshPluginDataDir, freshTmpDir, readFixture, runHookProcessWithEvent } from './hook-process.ts'

const COMPACT_FIXTURE = 'session-start.compact.json'

const halt = (detail: string): never => {
  throw new Error(`session-start-compact fixture: ${detail}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) halt(`git ${args.join(' ')}: ${result.stderr}`)
}

const initRepo = (): string => {
  const repo = freshTmpDir('logbook-session-start-compact-repo-')
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Session Start Compact Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'session-start-compact@logbook.test'])
  writeFileSync(path.join(repo, 'README.md'), 'logbook session-start compact fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

test('hook.session-start.compact-source-emits-the-held-thread-briefing', () => {
  const fixture = readFixture(COMPACT_FIXTURE)
  if (!isRecord(fixture) || typeof fixture.session_id !== 'string') return halt(`${COMPACT_FIXTURE} carries no session_id`)
  const sessionId = fixture.session_id
  const repo = initRepo()
  const pluginData = freshPluginDataDir('logbook-session-start-compact-plugin-data-')
  try {
    const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData.root }, cwd: repo })
    const opened = openStore(rt, repo)
    if (!opened.ok) return halt(`openStore refused: ${opened.message}`)
    const thread: Thread = {
      id: rt.ulid(),
      slug: 'compacted-thread',
      title: 'Keep gateway retries inside the upstream deadline',
      status: 'open',
      blocked_by: null,
      completion_criteria: [],
      spine: {
        active_goal: 'every gateway retry finishes before the upstream deadline expires',
        next_step: 'apply the jitter ruling in src/retry/policy.ts',
        next_step_records: [],
        landed: '',
        last_session: 'seeded',
        open_risks: [],
        key_decisions: [],
        out_of_scope: []
      },
      created_at: rt.now(),
      updated_at: rt.now()
    }
    const committed = opened.value.commit([{ kind: 'thread', record: thread }], 'seed the compacted thread')
    assert.equal(committed.ok, true, 'the fixture thread must commit')
    const layout = layoutFor(rt, repo)
    if (!layout.ok) return halt(`layoutFor refused: ${layout.message}`)
    mkdirSync(layout.value.state, { recursive: true })
    writePointer(rt, layout.value, { thread_id: thread.id, written_at: rt.now(), session_id: sessionId })

    const result = runHookProcessWithEvent(
      'session-start',
      { ...fixture, cwd: repo },
      { env: controlledEnv({ CLAUDE_PLUGIN_DATA: pluginData.root }) }
    )

    assert.equal(result.status, 0, `the SessionStart hook must exit 0, stderr: ${result.stderr}`)
    const printed = result.stdout.trim()
    assert.equal(printed.split('\n').length, 1, `the hook must print exactly one JSON object, got:\n${result.stdout}`)
    const parsed: unknown = JSON.parse(printed)
    assert.ok(isRecord(parsed) && isRecord(parsed.hookSpecificOutput), `the hook printed no hookSpecificOutput: ${printed}`)
    const output = parsed.hookSpecificOutput as Record<string, unknown>
    assert.equal(output.hookEventName, 'SessionStart')
    assert.equal(typeof output.additionalContext, 'string')
    const context = output.additionalContext as string
    assert.ok(context.startsWith(`${COMPACT_BRIEFING_HEADING}\n`), `the hook must carry the compact briefing, got:\n${context}`)
    assert.ok(context.includes(thread.id) && context.includes(thread.spine.next_step), context)
    assert.ok(context.length <= HOOK_CONTEXT_MAX_CODE_UNITS)
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData.home, { recursive: true, force: true })
  }
})
