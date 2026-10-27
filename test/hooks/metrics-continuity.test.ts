import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { rawGit } from '../support/git-fixture.ts'
import type { HookProcessResult } from '../support/run-hook.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; store: string; workingCopy: string; transcriptFolder: string }

type Line = Record<string, unknown>

const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const FOLDED_AT = new Date(Date.UTC(2026, 9, 14, 10, 0)).toISOString()
const AFTER_FOLD = new Date(Date.UTC(2026, 9, 14, 10, 30)).toISOString()
const C1_OPEN = '- [ ] c1 The login page loads'
const C1_TICKED = '- [x] c1 The login page loads evidence: the login test passed'
const C2_OPEN = '- [ ] c2 Errors show under the form'
const FILLER = 'Progress note. '

const fixLogin = (criteria: readonly string[], standing = 'The form renders but submitting it fails.'): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c3 D2 R2 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    ...criteria,
    '',
    '## Where things stand',
    '',
    standing,
    '',
    '## Next step',
    '',
    'Fix the submit handler.',
    '',
    '## Decisions in force',
    '',
    '- D1 Keep the session cookie: the mobile app reads it',
    '',
    '## Open risks',
    '',
    '- R1 The staging database may be stale',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md',
    ''
  ].join('\n')

const STORED = fixLogin([C1_OPEN, C2_OPEN])

const LONG_STORED = fixLogin([C1_OPEN, C2_OPEN], FILLER.repeat(700).trim())

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

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `logbook-metrics-continuity-${label}-`))

const transcriptOf = (fixture: Fixture, session: string): string => join(fixture.transcriptFolder, `${session}.jsonl`)

const withHeldThread = async (document: string, fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = scratch('repo')
  const home = scratch('home')
  const storeParent = scratch('store')
  try {
    initRepo(repo)
    const { findRepository, workingCopyPath } = await import('../../src/thread/paths.ts')
    const { commitDocuments } = await import('../../src/thread/store.ts')
    const { foldHold, takeHold } = await import('../../src/thread/holds.ts')
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 's-1' })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: document, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
    const transcriptFolder = join(home, 'P')
    takeHold(rt, found.value, 'fix-login', 's-1', join(transcriptFolder, 's-1.jsonl'))
    foldHold(rt, found.value, 'fix-login', FOLDED_AT)
    const workingCopy = workingCopyPath(found.value, 'fix-login')
    assert.ok(workingCopy.ok, 'the working copy path must be built')
    await fn({ repo, home, store: join(storeParent, 'store'), workingCopy: workingCopy.value, transcriptFolder })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(storeParent, { recursive: true, force: true })
  }
}

const writeFile = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const writeTranscript = (file: string, entries: readonly Line[]): void =>
  writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)

const runHook = async (fixture: Fixture, hook: string, event: Line): Promise<HookProcessResult> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook, event, env: { HOME: fixture.home, PLUGIN_METRICS_DIR: fixture.store } })
  assert.equal(run.code, 0, run.stderr)
  return run
}

const baseEvent = (fixture: Fixture, session: string, hookEventName: string): Line => ({
  session_id: session,
  transcript_path: transcriptOf(fixture, session),
  cwd: fixture.repo,
  hook_event_name: hookEventName
})

const startEvent = (fixture: Fixture, session: string, source: string): Line => ({
  ...baseEvent(fixture, session, 'SessionStart'),
  source
})

const endEvent = (fixture: Fixture, session: string, reason: string): Line => ({
  ...baseEvent(fixture, session, 'SessionEnd'),
  reason
})

const stopEvent = (fixture: Fixture): Line => ({ ...baseEvent(fixture, 's-1', 'Stop'), stop_hook_active: false })

const editEvent = (fixture: Fixture): Line => ({
  ...baseEvent(fixture, 's-1', 'PostToolUse'),
  prompt_id: 'p-0',
  tool_use_id: 'toolu_00',
  tool_name: 'Edit',
  tool_input: { file_path: fixture.workingCopy, old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false },
  tool_response: { filePath: fixture.workingCopy }
})

const commitEvent = (fixture: Fixture, toolUseId: string): Line => ({
  ...baseEvent(fixture, 's-1', 'PostToolUse'),
  prompt_id: 'p-1',
  tool_use_id: toolUseId,
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m x' },
  tool_response: { stdout: '[main 1234567] x', stderr: '' }
})

const outputOf = (run: HookProcessResult): Line => {
  const output: unknown = JSON.parse(run.stdout)
  assert.ok(typeof output === 'object' && output !== null && !Array.isArray(output), `stdout was ${run.stdout}`)
  return output as Line
}

const contextOf = (run: HookProcessResult): string => {
  const specific = outputOf(run).hookSpecificOutput as Line | undefined
  const context = specific?.additionalContext
  assert.equal(typeof context, 'string', run.stdout)
  return String(context)
}

const runFiles = (fixture: Fixture): string[] => {
  const folder = join(fixture.store, 'plugin=logbook', 'kind=event', `repo=${basename(fixture.repo)}`)
  return existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.startsWith('fix-login.') && name.endsWith('.jsonl'))
        .map((name) => join(folder, name))
    : []
}

const linesOf = (file: string): Line[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Line)

const runLines = (fixture: Fixture): Line[] => {
  const files = runFiles(fixture)
  assert.equal(files.length, 1, `expected one run file, found ${JSON.stringify(files)}`)
  return linesOf(files[0] ?? '')
}

const lastLine = (fixture: Fixture): Line => {
  const line = runLines(fixture).at(-1)
  assert.ok(line !== undefined, 'the run must hold a line')
  return line
}

const storeLines = (fixture: Fixture): Line[] =>
  existsSync(fixture.store)
    ? readdirSync(fixture.store, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.jsonl'))
        .flatMap((name) => linesOf(join(fixture.store, name)))
    : []

test('metrics.unwritable-store-keeps-hook-output', async () => {
  await withHeldThread(STORED, async (fixture) => {
    writeFile(fixture.store, 'not a folder\n')
    writeFile(fixture.workingCopy, fixLogin([C1_TICKED, C2_OPEN]))
    const post = await runHook(fixture, 'post-tool-use', editEvent(fixture))
    const start = await runHook(fixture, 'session-start', startEvent(fixture, 's-1', 'compact'))
    const stop = await runHook(fixture, 'stop', stopEvent(fixture))
    const end = await runHook(fixture, 'session-end', endEvent(fixture, 's-1', 'clear'))
    const runs = [post, start, stop, end]
    runs.forEach(outputOf)
    assert.ok(contextOf(post).startsWith('logbook: accepted the update to fix-login'), contextOf(post))
    assert.ok(contextOf(start).startsWith('Logbook: this session holds thread fix-login'), contextOf(start))
    assert.ok(
      runs.some((run) => run.stderr.includes('metrics not written: ')),
      runs.map((run) => run.stderr).join('\n')
    )
  })
})

test('metrics.compact-pickup-recorded', async () => {
  await withHeldThread(STORED, async (fixture) => {
    const run = await runHook(fixture, 'session-start', startEvent(fixture, 's-1', 'compact'))
    const line = lastLine(fixture)
    assert.equal(line.event, 'thread.pickup')
    assert.equal(line.source, 'compact')
    assert.equal(line.delivered, 'document')
    assert.equal(typeof line.activity_lines, 'number')
    assert.ok(Number(line.activity_lines) >= 0, String(line.activity_lines))
    assert.equal(line.context_chars, contextOf(run).length)
    assert.equal(line.session, 's-1')
  })
})

test('metrics.short-pickup-recorded', async () => {
  assert.ok(LONG_STORED.length > 9500, `the document is ${LONG_STORED.length} characters`)
  await withHeldThread(LONG_STORED, async (fixture) => {
    await runHook(fixture, 'session-start', startEvent(fixture, 's-1', 'resume'))
    const line = lastLine(fixture)
    assert.equal(line.event, 'thread.pickup')
    assert.equal(line.source, 'resume')
    assert.equal(line.delivered, 'short')
  })
})

test('metrics.clear-pickup-recorded', async () => {
  await withHeldThread(STORED, async (fixture) => {
    await runHook(fixture, 'session-end', endEvent(fixture, 's-1', 'clear'))
    await runHook(fixture, 'session-start', startEvent(fixture, 's-2', 'clear'))
    const [handover, pickup] = runLines(fixture).slice(-2)
    assert.equal(handover?.event, 'thread.handover')
    assert.equal(handover?.session, 's-1')
    assert.equal(pickup?.event, 'thread.pickup')
    assert.equal(pickup?.source, 'clear')
    assert.equal(pickup?.session, 's-2')
  })
})

test('metrics.startup-records-nothing', async () => {
  await withHeldThread(STORED, async (fixture) => {
    await runHook(fixture, 'session-start', startEvent(fixture, 's-1', 'startup'))
    assert.deepEqual(
      storeLines(fixture).filter((line) => line.event === 'thread.pickup'),
      []
    )
  })
})

test('metrics.handover-recorded', async () => {
  await withHeldThread(STORED, async (fixture) => {
    await runHook(fixture, 'session-end', endEvent(fixture, 's-1', 'clear'))
    const handovers = runLines(fixture).filter((line) => line.event === 'thread.handover')
    assert.equal(handovers.length, 1)
    assert.equal(handovers[0]?.session, 's-1')
  })
})

test('metrics.other-end-records-no-handover', async () => {
  await withHeldThread(STORED, async (fixture) => {
    await runHook(fixture, 'session-end', endEvent(fixture, 's-1', 'logout'))
    assert.deepEqual(
      storeLines(fixture).filter((line) => line.event === 'thread.handover'),
      []
    )
  })
})

test('metrics.milestone-request-recorded', async () => {
  await withHeldThread(STORED, async (fixture) => {
    await runHook(fixture, 'post-tool-use', commitEvent(fixture, 'toolu_01'))
    const line = lastLine(fixture)
    assert.equal(line.event, 'doc.request')
    assert.equal(line.reason, 'milestone')
  })
})

test('metrics.repeat-milestone-not-recorded', async () => {
  await withHeldThread(STORED, async (fixture) => {
    await runHook(fixture, 'post-tool-use', commitEvent(fixture, 'toolu_01'))
    await runHook(fixture, 'post-tool-use', commitEvent(fixture, 'toolu_02'))
    assert.equal(storeLines(fixture).filter((line) => line.event === 'doc.request').length, 1)
  })
})

test('metrics.stop-request-recorded', async () => {
  await withHeldThread(STORED, async (fixture) => {
    const projectFile = join(fixture.repo, 'src', 'login.ts')
    writeTranscript(transcriptOf(fixture, 's-1'), [
      {
        type: 'assistant',
        timestamp: AFTER_FOLD,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_e1',
              name: 'Edit',
              input: { file_path: projectFile, old_string: 'a', new_string: 'b', replace_all: false }
            }
          ]
        }
      }
    ])
    await runHook(fixture, 'stop', stopEvent(fixture))
    const line = lastLine(fixture)
    assert.equal(line.event, 'doc.request')
    assert.equal(line.reason, 'turn-changed')
  })
})
