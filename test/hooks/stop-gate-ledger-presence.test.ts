import { test } from 'node:test'
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
import { LEDGER_REF } from '../../src/store/ref.ts'
import { writePointer } from '../../src/domain/pointer.ts'
import { runSessionStart } from '../../src/cli/session-start.ts'
import { stopGateVerdict } from '../../src/hooklib/stop-gate.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit } from '../support/git-fixture.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const SESSION_ID = 'stop-gate-ledger-presence-session'
const OTHER_SESSION_ID = 'stop-gate-ledger-presence-other-session'

const BANNED_LITERALS = [
  'NUDGE_TEXT',
  'computeNudgeThreshold',
  'LEDGER_NUDGE_FRACTION',
  'LEDGER_NUDGE_BYTES',
  ['approaching the ', 'compaction threshold'].join('')
]

const RECORDS_REACHED_BUT_NOT_FILED_UNDER_THREAD = 'but none of them is filed under thread'

const setupFixtureRepo = (repo: string): void => {
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

const makeThread = (rt: Runtime, slug: string, id?: string): Extract<RecordChange, { kind: 'thread' }> => ({
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

type Fixture = { rt: Runtime; repo: string; layout: StoreLayout }

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
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

const commitOneThread = (rt: Runtime, repo: string, slug: string): string => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const change = makeThread(rt, slug)
  const committed = opened.value.commit([change], `seed ${slug}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
  return change.record.id
}

const commitToThread = (rt: Runtime, repo: string, threadId: string, slug: string): void => {
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

const commitSessionEntry = (rt: Runtime, repo: string, threadId: string, body: string): void => {
  const opened = openStore(rt, repo)
  assert.equal(opened.ok, true, 'the fixture store must open')
  if (!opened.ok) throw new Error('unreachable')
  const change = makeSessionEntry(rt, threadId, body)
  const committed = opened.value.commit([change], `seed session entry for ${threadId}`)
  assert.equal(committed.ok, true, 'the fixture write must reach the ledger ref')
}

const startSession = (rt: Runtime, repo: string, sessionId: string): void => {
  runSessionStart(rt, { session_id: sessionId, source: 'startup', cwd: repo })
}

const resumeAs = async (rt: Runtime, sessionId: string, threadId: string): Promise<void> => {
  const resumeRt: Runtime = { ...rt, sessionId }
  const reply = await resumeThreadTool.handler(resumeRt, STUB_TOOL_CTX, { thread_id: threadId })
  assert.equal(reply.ok, true, 'resume_thread must succeed for the fixture to establish a resume baseline')
}

const stopEventFor = (repo: string, sessionId: string, stopHookActive: boolean) => ({
  session_id: sessionId,
  cwd: repo,
  transcript_path: join(repo, 'no-such-transcript.jsonl'),
  stop_hook_active: stopHookActive
})

test('hook.stop-gate-blocks-when-nothing-reached-the-ledger-since-resume', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'block', 'the stop gate must block when the ledger ref has not moved since resume')
  })
})

test('hook.stop-gate-clears-when-the-held-thread-reaches-the-ledger', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')

    commitToThread(rt, repo, threadId, 'stop-gate-presence-recorded')

    const cleared = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(cleared.kind, 'silent', 'the stop gate must clear once the held thread itself has reached the ledger ref')
  })
})

test('hook.stop-gate-still-blocks-when-only-an-unrelated-thread-moved', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')

    commitOneThread(rt, repo, 'stop-gate-presence-unrelated')

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(
      verdict.kind,
      'block',
      'the stop gate must keep blocking when the ledger moved only for a thread other than the one this session holds'
    )
    if (verdict.kind === 'block') {
      assert.ok(
        verdict.reason.includes(threadId),
        `the blocking message must name the held thread ${threadId}, got: ${verdict.reason}`
      )
      assert.ok(
        verdict.reason.includes(RECORDS_REACHED_BUT_NOT_FILED_UNDER_THREAD),
        `the blocking message must say records reached the ledger but not this thread, got: ${verdict.reason}`
      )
      assert.ok(
        verdict.reason.includes('makes no claim that what is recorded is complete'),
        `the blocking message must disclaim completeness, got: ${verdict.reason}`
      )
    }
  })
})

test('hook.stop-gate-clears-on-a-session-entry-for-the-held-thread', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')

    commitSessionEntry(rt, repo, threadId, 'a session log entry filed under the held thread')

    const cleared = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(
      cleared.kind,
      'silent',
      'the stop gate must clear once a session entry filed under the held thread reaches the ledger ref'
    )
  })
})

test('hook.stop-gate-still-blocks-on-a-session-entry-for-another-thread', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    const otherThreadId = rt.ulid()
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')

    commitSessionEntry(rt, repo, otherThreadId, 'a session log entry filed under a different thread')

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(
      verdict.kind,
      'block',
      'the stop gate must keep blocking when the session entry that reached the ledger is filed under a different thread'
    )
  })
})

test('hook.stop-gate-re-evaluates-rather-than-latching', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'block')
    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind,
      'block',
      'the verdict is evaluated at every turn end, never latched to fire once per session'
    )

    commitToThread(rt, repo, threadId, 'stop-gate-presence-recorded')
    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false)).kind, 'silent')
  })
})

test('hook.stop-gate-is-silent-when-the-stop-hook-is-already-active', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, true))
    assert.equal(verdict.kind, 'silent', 'blocking while the stop hook is already active would not terminate')
  })
})

test('hook.stop-gate-is-silent-when-no-thread-is-being-worked-by-this-session', async () => {
  await withFixture(async ({ rt, repo, layout }) => {
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

test('hook.stop-gate-is-silent-when-this-session-recorded-no-resume-baseline', async () => {
  await withFixture(async ({ rt, repo, layout }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, OTHER_SESSION_ID)
    await resumeAs(rt, OTHER_SESSION_ID, threadId)
    writePointer(rt, layout, { thread_id: threadId, written_at: '2024-01-01T00:00:00.000Z', session_id: SESSION_ID })

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'silent', 'without a resume baseline for this session there is no window to compare against')
  })
})

test('hook.stop-gate-is-silent-when-the-project-had-no-ledger-ref-at-resume', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)

    const deleted = rawGit(repo, ['update-ref', '-d', LEDGER_REF])
    assert.equal(deleted.status, 0, `the fixture must be able to remove the ledger ref: ${deleted.stderr}`)

    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'silent', 'a resume that recorded no ledger head has no window to compare against')
  })
})

test('hook.stop-gate-ledger-message-claims-presence-and-never-completeness', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(verdict.kind, 'block')
    if (verdict.kind !== 'block') return

    assert.ok(
      verdict.reason.includes(threadId),
      `the blocking message must name the held thread ${threadId}, got: ${verdict.reason}`
    )
    assert.equal(
      verdict.reason.includes(RECORDS_REACHED_BUT_NOT_FILED_UNDER_THREAD),
      false,
      `the blocking message must not claim records reached the ledger when nothing did, got: ${verdict.reason}`
    )
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

test('hook.stop-gate-blocks-when-a-ledger-write-lands-before-resume-and-nothing-after', async () => {
  await withFixture(async ({ rt, repo }) => {
    const threadId = commitOneThread(rt, repo, 'stop-gate-presence-seed')
    startSession(rt, repo, SESSION_ID)

    commitOneThread(rt, repo, 'stop-gate-presence-pre-resume')

    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))
    assert.equal(
      verdict.kind,
      'block',
      'the stop gate must block when nothing has reached the ledger since resume_thread ran, even though ' +
        'a write landed between session start and the resume'
    )
  })
})
