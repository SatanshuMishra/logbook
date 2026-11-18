import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { answerHookEvent, type HookEventFields } from '../../src/hook/event.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { HOOK_EVENT_FIELDS } from '../../src/server/hook-tool.ts'
import { readHold, takeHold } from '../../src/thread/holds.ts'
import { listMarkers } from '../../src/thread/inflight.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime; transcript: string }

type Line = Record<string, unknown>

const SLUG = 'work'
const SESSION = 's1'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const UPDATE_OPENING = "logbook: update thread work's state document."

const workDocument = (): string => {
  const lines = [
    '# work: Finish the work',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    'The work is finished.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The work ships',
    '',
    '## Where things stand',
    '',
    'Nothing is built yet.',
    '',
    '## Next step',
    '',
    'Start the work.',
    '',
    '## Decisions in force',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    ''
  ]
  return `${lines.join('\n')}\n`
}

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const withThread = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-hook-event-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-hook-event-home-'))
  try {
    initRepo(repo)
    const rt = testRuntime({
      start: new Date().toISOString(),
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: home },
      sessionId: SESSION
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: SLUG, text: workDocument(), expectedBlob: null }],
      message: 'open_thread work: opened'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
    takeHold(rt, found.value, SLUG, SESSION, null)
    await fn({ repo, home, paths: found.value, rt, transcript: join(home, 'transcripts', 's1.jsonl') })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const fieldsOf = (fixture: Fixture, given: HookEventFields): HookEventFields => ({
  ...Object.fromEntries(HOOK_EVENT_FIELDS.map((field) => [field, ''])),
  session_id: SESSION,
  cwd: fixture.repo,
  transcript_path: fixture.transcript,
  ...given
})

const bashFields = (fixture: Fixture, toolUseId: string, given: HookEventFields = {}): HookEventFields =>
  fieldsOf(fixture, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: JSON.stringify({ command: 'npm test' }),
    tool_use_id: toolUseId,
    ...given
  })

const markerIds = (fixture: Fixture): string[] => listMarkers(fixture.paths, SLUG).map((marker) => marker.tool_use_id)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const specificOf = (reply: string, eventName: string): Record<string, unknown> => {
  const output: unknown = JSON.parse(reply)
  assert.ok(isRecord(output), `the reply must be an object, got ${reply}`)
  assert.equal('decision' in output, false, `the reply must carry no decision, got ${reply}`)
  const specific = output.hookSpecificOutput
  assert.ok(isRecord(specific), `the reply must carry hookSpecificOutput, got ${reply}`)
  assert.equal(specific.hookEventName, eventName)
  assert.equal(typeof specific.additionalContext, 'string')
  return specific
}

const writeTranscript = (file: string, lines: readonly Line[]): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

const editLines = (fixture: Fixture, timestamp: string): Line[] => [
  {
    type: 'assistant',
    timestamp,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_edit',
          name: 'Edit',
          input: { file_path: join(fixture.repo, 'README.md'), old_string: 'logbook', new_string: 'Logbook' }
        }
      ]
    }
  },
  {
    type: 'user',
    timestamp,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_edit', content: 'edited' }] }
  },
  { type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Edited the readme.' }] } }
]

test('hook-event.pre-tool-use-marks-a-main-session-call', async () => {
  await withThread(async (fixture) => {
    const reply = await answerHookEvent(fixture.rt, bashFields(fixture, 'toolu_01'))

    assert.equal(reply, '{}')
    assert.deepEqual(markerIds(fixture), ['toolu_01'])
    assert.ok(readHold(fixture.paths, SLUG)?.transcripts.includes(fixture.transcript))
  })
})

test('hook-event.post-tool-use-clears-the-marker-and-asks-after-a-commit', async () => {
  await withThread(async (fixture) => {
    const commit = { tool_input: JSON.stringify({ command: 'git commit -m step' }) }
    await answerHookEvent(fixture.rt, bashFields(fixture, 'toolu_02', commit))
    assert.deepEqual(markerIds(fixture), ['toolu_02'])

    const reply = await answerHookEvent(
      fixture.rt,
      bashFields(fixture, 'toolu_02', {
        ...commit,
        hook_event_name: 'PostToolUse',
        tool_response: JSON.stringify({ stdout: '[main 1a2b3c4] step', stderr: '' }),
        prompt_id: 'p1'
      })
    )

    assert.equal(markerIds(fixture).includes('toolu_02'), false)
    const context = String(specificOf(reply, 'PostToolUse').additionalContext)
    assert.ok(context.startsWith(UPDATE_OPENING), context)
  })
})

test('hook-event.stop-asks-after-a-changing-turn', async () => {
  await withThread(async (fixture) => {
    writeTranscript(fixture.transcript, editLines(fixture, new Date(Date.now() + 60_000).toISOString()))
    const stopFields = (active: string): HookEventFields =>
      fieldsOf(fixture, { hook_event_name: 'Stop', stop_hook_active: active })

    const first = await answerHookEvent(fixture.rt, stopFields('false'))
    const second = await answerHookEvent(fixture.rt, stopFields('true'))

    const context = String(specificOf(first, 'Stop').additionalContext)
    assert.ok(context.includes(UPDATE_OPENING), context)
    assert.equal(second, '{}')
  })
})

test('hook-event.answers-nothing-it-does-not-serve', async () => {
  await withThread(async (fixture) => {
    const outside = mkdtempSync(join(tmpdir(), 'logbook-hook-event-outside-'))
    try {
      const replies = await Promise.all([
        answerHookEvent(fixture.rt, bashFields(fixture, 'toolu_41', { session_id: '' })),
        answerHookEvent(fixture.rt, bashFields(fixture, 'toolu_42', { cwd: outside })),
        answerHookEvent(fixture.rt, bashFields(fixture, 'toolu_43', { hook_event_name: 'SessionStart' })),
        answerHookEvent(fixture.rt, bashFields(fixture, 'toolu_44', { tool_name: 'Read' }))
      ])

      assert.deepEqual(replies, ['{}', '{}', '{}', '{}'])
      assert.deepEqual(markerIds(fixture), [])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

test('hook-event.reads-text-that-is-not-json-as-no-input', async () => {
  await withThread(async (fixture) => {
    const reply = await answerHookEvent(fixture.rt, bashFields(fixture, 'toolu_05', { tool_input: 'not json' }))

    assert.equal(reply, '{}')
    assert.deepEqual(markerIds(fixture), ['toolu_05'])
  })
})
