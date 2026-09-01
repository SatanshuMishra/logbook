import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { StoreLayout } from '../../src/store/layout.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { openStore } from '../../src/store/records.ts'
import { writePointer } from '../../src/domain/pointer.ts'
import { runSessionStart } from '../../src/cli/session-start.ts'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SESSION_ID = 'stop-gate-ledger-presence-session'
const OTHER_SESSION_ID = 'stop-gate-ledger-presence-other-session'

const BANNED_LITERALS = [
  'NUDGE_TEXT',
  'computeNudgeThreshold',
  'LEDGER_NUDGE_FRACTION',
  'LEDGER_NUDGE_BYTES',
  ['approaching the ', 'compaction threshold'].join('')
]

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-stop-gate-presence-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: 'a stop gate presence thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

type Fixture = { rt: Runtime; repo: string; layout: StoreLayout }

const withFixture = (fn: (fixture: Fixture) => void): void => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      fn({ rt, repo, layout: layout.value })
    })
  })
}

const commitOneThread = (rt: Runtime, repo: string, slug: string): string => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const change = makeThread(rt, slug)
  const committed = opened.value.commit([change], `seed ${slug}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
  return change.record.id
}

const startSession = (rt: Runtime, repo: string, sessionId: string): void => {
  runSessionStart(rt, { session_id: sessionId, source: 'startup', cwd: repo })
}

const stopEventFor = (repo: string, sessionId: string, stopHookActive: boolean) => ({
  session_id: sessionId,
  cwd: repo,
  transcript_path: join(repo, 'no-such-transcript.jsonl'),
  stop_hook_active: stopHookActive
})

test('hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'block', 'the stop gate must block when the ledger ref has not moved since resume')
  })
})

test('hook.stop-gate-clears-the-moment-something-reaches-the-ledger', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')

    commitOneThread(rt, repo, 'stop-gate-presence-recorded')

    const cleared = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(cleared.kind, 'silent', 'the stop gate must clear once something has reached the ledger ref')
  })
})

test('hook.stop-gate-re-evaluates-rather-than-latching', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')
    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind,
      'block',
      'the verdict is evaluated at every turn end, never latched to fire once per session'
    )

    commitOneThread(rt, repo, 'stop-gate-presence-recorded')
    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'silent')
  })
})

test('hook.stop-gate-is-silent-when-the-stop-hook-is-already-active', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, true))
    assert.equal(verdict.kind, 'silent', 'blocking while the stop hook is already active would not terminate')
  })
})

test('hook.stop-gate-is-silent-when-no-thread-is-being-worked-by-this-session', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind,
      'silent',
      'no thread is being worked, so there is nothing to record against'
    )

    writePointer(rt, layout, {
      thread_id: threadId,
      written_at: '2024-01-01T00:00:00.000Z',
      session_id: OTHER_SESSION_ID
    })
    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind,
      'silent',
      'a pointer held by another session is not this session work'
    )
  })
})

test('hook.stop-gate-is-silent-when-this-session-recorded-no-baseline', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, OTHER_SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'silent', 'without a baseline for this session there is no window to compare against')
  })
})

test('hook.stop-gate-is-silent-when-the-project-had-no-ledger-ref-at-session-start', () => {
  withFixture(({ rt, repo, layout }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'silent', 'a session that began before the ledger ref existed has no window to compare against')
  })
})

test('hook.stop-gate-ledger-message-claims-presence-and-never-completeness', () => {
  withFixture(({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'block')
    if (verdict.kind !== 'block') return

    assert.ok(
      verdict.reason.includes('makes no claim that what is recorded is complete'),
      `the blocking message must disclaim completeness, got: ${verdict.reason}`
    )
    for (const literal of BANNED_LITERALS) {
      assert.equal(
        verdict.reason.includes(literal),
        false,
        `the blocking message carries the retired compaction-nudge literal ${JSON.stringify(literal)}`
      )
    }
  })
})
