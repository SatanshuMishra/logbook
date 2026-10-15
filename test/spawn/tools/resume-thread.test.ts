import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ulid } from 'ulid'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { foldHold, releaseHold, takeHold, writeRedirect } from '../../../src/thread/holds.ts'
import { writeMarker } from '../../../src/thread/inflight.ts'
import { migrateIfNeeded } from '../../../src/thread/migrate.ts'
import {
  convertedPath,
  findRepository,
  holdPath,
  markerPath,
  redirectPath,
  workingCopyPath,
  type RepoPaths
} from '../../../src/thread/paths.ts'
import { commitDocuments, readDocument } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const THREADS_REF = 'refs/logbook/threads'
const LEDGER_REF = 'refs/logbook/ledger'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const STAND = 'The form renders but submitting it fails.'
const R1_LINE = '- R1 The staging database may be stale'

const GIT_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

type MakeDir = (prefix: string) => string

type Clone = { repo: string; home: string; paths: RepoPaths; rt: Runtime }

const withDirs = async (fn: (makeDir: MakeDir) => Promise<void>): Promise<void> => {
  const made: string[] = []
  const makeDir: MakeDir = (prefix) => {
    const dir = mkdtempSync(join(tmpdir(), `logbook-resume-${prefix}-`))
    made.push(dir)
    return dir
  }
  try {
    await fn(makeDir)
  } finally {
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
  }
}

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const gitWithInput = (repo: string, args: string[], input: string): string => {
  const result = spawnSync('git', ['-C', repo, ...args], { env: GIT_ENV, encoding: 'utf8', input })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const fixLogin = (stand: string, risks: readonly string[] = [R1_LINE]): string => {
  const lines = [
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
    '- [ ] c1 The login page loads',
    '- [ ] c2 The session survives a reload',
    '',
    '## Where things stand',
    '',
    stand,
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
    ...risks,
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md'
  ]
  return `${lines.join('\n')}\n`
}

const cloneIn = (makeDir: MakeDir, name: string): Clone => {
  const repo = makeDir(`${name}-repo`)
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', `Logbook Fixture ${name}`])
  mustGit(repo, ['config', 'user.email', `${name}@logbook.test`])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  const home = makeDir(`${name}-home`)
  const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 'seed', start: STORED_AT })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the test repository must be found')
  return { repo, home, paths: found.value, rt }
}

const seed = (clone: Clone, text: string): void => {
  const stored = readDocument(clone.rt, clone.paths, 'fix-login')
  const committed = commitDocuments(clone.rt, clone.paths, {
    changes: [{ slug: 'fix-login', text, expectedBlob: stored?.blob ?? null }],
    message: 'update fix-login'
  })
  assert.ok(committed.ok, 'the stored document must be committed')
}

const fileAt = (file: { ok: true; value: string } | { ok: false }): string => {
  assert.ok(file.ok, 'the path must be built')
  return file.value
}

const writeAt = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const resumeCalls = async (
  clone: Clone,
  session: string,
  calls: readonly Record<string, unknown>[]
): Promise<CallToolResult[]> => {
  const spawned = await spawnServer({
    projectRoot: clone.repo,
    entry: ENTRY,
    env: { CLAUDE_CODE_SESSION_ID: session, HOME: clone.home }
  })
  try {
    const replies: CallToolResult[] = []
    for (const args of calls) {
      replies.push((await spawned.client.callTool({ name: 'resume_thread', arguments: args })) as CallToolResult)
    }
    return replies
  } finally {
    await spawned.close()
  }
}

const resumeOnce = async (clone: Clone, session: string, args: Record<string, unknown>): Promise<CallToolResult> => {
  const [reply] = await resumeCalls(clone, session, [args])
  assert.ok(reply !== undefined, 'the call must have a reply')
  return reply
}

const textOf = (reply: CallToolResult): string => {
  const first = reply.content[0]
  assert.ok(first !== undefined && first.type === 'text', 'the reply must carry a text content block')
  return first.text
}

const assertSucceeded = (reply: CallToolResult): void => {
  assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
}

type Resumed = { thread_id: string; briefing: string; path: string; recovery: string[] }

const resumedOf = (reply: CallToolResult): Resumed => {
  assertSucceeded(reply)
  return reply.structuredContent as Resumed
}

const refusedField = (reply: CallToolResult): string => {
  assert.equal(reply.isError, true, `expected a refusal, got: ${JSON.stringify(reply)}`)
  const lines = textOf(reply).split('\n')
  const index = lines.findIndex((line) => line.startsWith('field: '))
  assert.ok(index >= 0, `the refusal must have a "field: " line, got:\n${textOf(reply)}`)
  assert.ok(
    (lines[index + 1] ?? '').startsWith('accepted: '),
    `the field line must be followed by an "accepted: " line, got:\n${textOf(reply)}`
  )
  return (lines[index] ?? '').slice('field: '.length)
}

const storedText = (clone: Clone): string => mustGit(clone.repo, ['cat-file', 'blob', `${THREADS_REF}:fix-login.md`])

const tipOf = (clone: Clone): string => mustGit(clone.repo, ['rev-parse', THREADS_REF]).trim()

const holderOf = (clone: Clone): unknown => {
  const parsed: unknown = JSON.parse(readFileSync(fileAt(holdPath(clone.paths, 'fix-login')), 'utf8'))
  assert.ok(typeof parsed === 'object' && parsed !== null, 'the hold file must hold an object')
  return (parsed as Record<string, unknown>).holder
}

const linesAfter = (recovery: readonly string[], heading: string): string[] => {
  const index = recovery.indexOf(heading)
  assert.ok(index >= 0, `the recovery must hold "${heading}", got:\n${recovery.join('\n')}`)
  return recovery.slice(index + 1)
}

const linkOrigin = (makeDir: MakeDir, clones: readonly Clone[]): string => {
  const origin = makeDir('origin')
  mustGit(origin, ['init', '--bare', '--initial-branch=main'])
  for (const clone of clones) mustGit(clone.repo, ['remote', 'add', 'origin', origin])
  return origin
}

const pushThreads = (clone: Clone): void => {
  mustGit(clone.repo, ['push', '--quiet', 'origin', `${THREADS_REF}:${THREADS_REF}`])
}

const fetchThreads = (clone: Clone): void => {
  mustGit(clone.repo, ['fetch', '--quiet', 'origin', `+${THREADS_REF}:${THREADS_REF}`])
}

const oldThread = (id: string): Record<string, unknown> => ({
  id,
  slug: 'fix-login',
  title: 'Fix the login page',
  status: 'open',
  blocked_by: null,
  created_at: STORED_AT,
  updated_at: STORED_AT,
  completion_criteria: [],
  spine: {
    active_goal: 'Users can log in again.',
    next_step: 'Fix the submit handler.',
    landed: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  }
})

const buildLedger = (clone: Clone, id: string): void => {
  const blob = gitWithInput(clone.repo, ['hash-object', '-w', '--stdin'], JSON.stringify(oldThread(id), null, 2))
  const threads = gitWithInput(clone.repo, ['mktree'], `100644 blob ${blob}\t${id}.json\n`)
  const tree = gitWithInput(clone.repo, ['mktree'], `040000 tree ${threads}\tthreads\n`)
  const commit = gitWithInput(clone.repo, ['commit-tree', tree, '-m', 'old ledger'], '')
  mustGit(clone.repo, ['update-ref', LEDGER_REF, commit])
}

const userEntry = (text: string, at: string): Record<string, unknown> => ({
  type: 'user',
  timestamp: at,
  message: { role: 'user', content: text }
})

const bashEntry = (id: string, command: string, at: string): Record<string, unknown> => ({
  type: 'assistant',
  timestamp: at,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] }
})

const resultEntry = (id: string, text: string, at: string): Record<string, unknown> => ({
  type: 'user',
  timestamp: at,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }
})

const minuteAt = (minute: number): string => new Date(Date.UTC(2026, 9, 14, 9, minute)).toISOString()

test('resume_thread.spawn.contract', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'contract')
    seed(clone, fixLogin(STAND))
    takeHold(clone.rt, clone.paths, 'fix-login', 's1', null)
    releaseHold(clone.rt, clone.paths, 'fix-login')

    const reply = await resumeOnce(clone, 's2', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    const stored = storedText(clone)
    assert.ok(textOf(reply).startsWith('Resumed thread fix-login.'), `unexpected reply text: ${textOf(reply)}`)
    assert.ok(textOf(reply).includes(stored.trimEnd()), `the reply must hold the document, got:\n${textOf(reply)}`)
    assert.ok(textOf(reply).includes('do not print it'), `the reply must say not to print it, got:\n${textOf(reply)}`)
    assert.equal(resumed.thread_id, 'fix-login')
    assert.equal(resumed.briefing, stored)
    assert.equal(resumed.path, fileAt(workingCopyPath(clone.paths, 'fix-login')))
    assert.deepEqual(resumed.recovery, [])
    assert.equal(holderOf(clone), 's2')
  })
})

test('resume_thread.rejects-invalid', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'invalid')
    seed(clone, fixLogin(STAND))

    const replies = await resumeCalls(clone, 's1', [
      {},
      { thread_id: 'ghost' },
      { thread_id: 'fix-login', full_briefing: 'yes' },
      { thread_id: 'fix-login', pickup: true }
    ])

    assert.deepEqual(replies.map(refusedField), ['thread_id', 'thread_id', 'full_briefing', 'pickup'])
  })
})

test('resume_thread.resolves-an-old-id', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'old-id')
    const oldId = ulid()
    buildLedger(clone, oldId)

    const reply = await resumeOnce(clone, 's1', { thread_id: oldId })

    const resumed = resumedOf(reply)
    assert.equal(resumed.thread_id, 'fix-login')
    const aliases: unknown = JSON.parse(mustGit(clone.repo, ['cat-file', 'blob', `${THREADS_REF}:aliases.json`]))
    assert.deepEqual(aliases, { [oldId]: 'fix-login' })
  })
})

test('resume_thread.takes-over-and-shows-the-earlier-activity', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'takeover')
    seed(clone, fixLogin(STAND))
    const transcript = join(makeDir('transcripts'), 's1.jsonl')
    const entries = [
      userEntry('an earlier message', minuteAt(10)),
      bashEntry('toolu_test', 'npm test', minuteAt(31)),
      resultEntry('toolu_test', 'all tests passed', minuteAt(32)),
      userEntry('ship it', minuteAt(33))
    ]
    writeFileSync(transcript, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    takeHold(clone.rt, clone.paths, 'fix-login', 's1', transcript)
    foldHold(clone.rt, clone.paths, 'fix-login', minuteAt(30))

    const reply = await resumeOnce(clone, 's2', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    const activity = linesAfter(resumed.recovery, 'Activity since the last update:')
    assert.ok(activity.includes('Bash: npm test'), `the activity must hold the Bash call, got:\n${activity.join('\n')}`)
    assert.ok(activity.includes('User: ship it'), `the activity must hold the user message, got:\n${activity.join('\n')}`)
    assert.ok(
      !activity.includes('User: an earlier message'),
      `the activity must leave out what came before folded_at, got:\n${activity.join('\n')}`
    )
    assert.ok(textOf(reply).includes('Activity since the last update:'), 'the reply text must hold the recovery lines')
    assert.equal(holderOf(clone), 's2')
  })
})

test('resume_thread.after-a-clear-holds-for-the-new-session', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'clear')
    seed(clone, fixLogin(STAND))
    writeRedirect(clone.rt, clone.paths, 's1', 's2')

    const reply = await resumeOnce(clone, 's1', { thread_id: 'fix-login' })

    resumedOf(reply)
    assert.equal(holderOf(clone), 's2')
  })
})

test('resume_thread.with-a-broken-redirect-holds-for-the-server-session', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'broken-redirect')
    seed(clone, fixLogin(STAND))
    writeAt(fileAt(redirectPath(clone.paths, 's1')), '{')

    const reply = await resumeOnce(clone, 's1', { thread_id: 'fix-login' })

    resumedOf(reply)
    assert.equal(holderOf(clone), 's1')
  })
})

test('resume_thread.with-a-broken-hold-file', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'broken-hold')
    seed(clone, fixLogin(STAND))
    writeAt(fileAt(holdPath(clone.paths, 'fix-login')), '{')

    const reply = await resumeOnce(clone, 's2', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    assert.ok(
      !resumed.recovery.includes('Activity since the last update:'),
      `the recovery must have no activity group, got:\n${resumed.recovery.join('\n')}`
    )
    assert.equal(holderOf(clone), 's2')
  })
})

test('resume_thread.again-by-the-holder', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'holder')
    seed(clone, fixLogin(STAND))
    takeHold(clone.rt, clone.paths, 'fix-login', 's1', null)

    const reply = await resumeOnce(clone, 's1', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    assert.equal(holderOf(clone), 's1')
    assert.ok(textOf(reply).includes(storedText(clone).trimEnd()), `the reply must hold the document, got:\n${textOf(reply)}`)
    assert.equal(resumed.briefing, storedText(clone))
  })
})

test('resume_thread.lists-what-was-running', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'markers')
    seed(clone, fixLogin(STAND))
    const written = writeMarker(clone.rt, clone.paths, 'fix-login', {
      toolUseId: 'toolu_build',
      tool: 'Bash',
      toolInput: { command: 'npm run build' },
      session: 's1'
    })
    assert.ok(written, 'the marker must be written')
    writeAt(fileAt(markerPath(clone.paths, 'fix-login', 'toolu_broken')), '{')

    const reply = await resumeOnce(clone, 's2', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    const running = linesAfter(resumed.recovery, 'Was running when the session ended:')
    assert.equal(running.length, 1, `exactly one line must follow the heading, got:\n${running.join('\n')}`)
    const [line] = running
    assert.ok(line !== undefined && line.includes('Bash') && line.includes('npm run build'), `unexpected line: ${line}`)
  })
})

test('resume_thread.accepts-a-pending-valid-edit', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'valid-edit')
    seed(clone, fixLogin(STAND))
    const before = tipOf(clone)
    const edited = 'The submit handler posts the form; the redirect after login still fails.'
    writeAt(fileAt(workingCopyPath(clone.paths, 'fix-login')), fixLogin(edited))

    const reply = await resumeOnce(clone, 's1', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    assert.notEqual(tipOf(clone), before, 'the pending edit must be committed')
    assert.ok(storedText(clone).includes(edited), `the stored document must hold the edit, got:\n${storedText(clone)}`)
    assert.ok(resumed.briefing.includes(edited), `the briefing must hold the edit, got:\n${resumed.briefing}`)
    assert.ok(!resumed.briefing.includes(STAND), 'the briefing must no longer hold the old line')
  })
})

test('resume_thread.reports-refused-edits', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'refused-edit')
    seed(clone, fixLogin(STAND))
    const before = tipOf(clone)
    const workingCopy = fileAt(workingCopyPath(clone.paths, 'fix-login'))
    const silentRemoval = fixLogin(STAND, [])
    writeAt(workingCopy, silentRemoval)

    const reply = await resumeOnce(clone, 's1', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    const refused = linesAfter(resumed.recovery, 'The working copy has edits logbook refused:')
    assert.ok(
      refused.some((line) => line.includes('R1 was removed')),
      `the recovery must name the R1 violation, got:\n${refused.join('\n')}`
    )
    assert.equal(readFileSync(workingCopy, 'utf8'), silentRemoval)
    assert.equal(tipOf(clone), before, 'a refused edit must commit nothing')
    assert.ok(resumed.briefing.includes(R1_LINE), 'the briefing must be the stored document, which still holds R1')
  })
})

test('resume_thread.asks-to-tidy-a-converted-document', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'converted')
    buildLedger(clone, ulid())

    const [first, second] = await resumeCalls(clone, 's1', [{ thread_id: 'fix-login' }, { thread_id: 'fix-login' }])

    assert.ok(first !== undefined && second !== undefined, 'both calls must have replies')
    const firstRecovery = resumedOf(first).recovery
    const workingCopy = fileAt(workingCopyPath(clone.paths, 'fix-login'))
    assert.ok(
      firstRecovery.some(
        (line) =>
          line.includes(workingCopy) && line.includes('was converted from the old ledger') && line.includes('keeping every id')
      ),
      `the first recovery must hold the tidy request, got:\n${firstRecovery.join('\n')}`
    )
    assert.equal(existsSync(fileAt(convertedPath(clone.paths, 'fix-login'))), false, 'the mark must be deleted')
    const secondRecovery = resumedOf(second).recovery
    assert.ok(
      !secondRecovery.some((line) => line.includes('was converted from the old ledger')),
      `the second recovery must not hold the tidy request, got:\n${secondRecovery.join('\n')}`
    )
  })
})

test('resume_thread.asks-to-tidy-after-a-tidy-elsewhere', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const a = cloneIn(makeDir, 'tidier')
    const b = cloneIn(makeDir, 'resumer')
    linkOrigin(makeDir, [a, b])
    buildLedger(b, ulid())
    const migrated = migrateIfNeeded(b.rt, b.paths)
    assert.ok(migrated.ok && migrated.value.migrated, 'the old ledger must be migrated')
    assert.equal(existsSync(fileAt(convertedPath(b.paths, 'fix-login'))), true, 'the migration must leave the mark')
    pushThreads(b)
    fetchThreads(a)
    const tidied = 'The converted document was tidied in another clone.'
    seed(a, fixLogin(tidied))
    pushThreads(a)

    const reply = await resumeOnce(b, 's1', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    assert.ok(resumed.briefing.includes(tidied), `the briefing must hold the tidied document, got:\n${resumed.briefing}`)
    assert.ok(
      resumed.recovery.some((line) => line.includes('was converted from the old ledger')),
      `the recovery must hold the tidy request, got:\n${resumed.recovery.join('\n')}`
    )
    assert.equal(existsSync(fileAt(convertedPath(b.paths, 'fix-login'))), false, 'the mark must be deleted')
  })
})

test('resume_thread.reports-a-failed-sync', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'failed-sync')
    seed(clone, fixLogin(STAND))
    mustGit(clone.repo, ['remote', 'add', 'origin', join(makeDir('missing-parent'), 'missing-origin')])

    const reply = await resumeOnce(clone, 's1', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    assert.ok(
      resumed.recovery.some((line) => line.startsWith('Sync with origin failed:')),
      `the recovery must report the failed sync, got:\n${resumed.recovery.join('\n')}`
    )
    assert.equal(resumed.thread_id, 'fix-login')
    assert.equal(resumed.briefing, storedText(clone))
    assert.equal(holderOf(clone), 's1')
  })
})

test('resume_thread.brings-in-origin-changes', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const a = cloneIn(makeDir, 'pusher')
    const b = cloneIn(makeDir, 'puller')
    linkOrigin(makeDir, [a, b])
    seed(b, fixLogin(STAND))
    pushThreads(b)
    fetchThreads(a)
    const update = 'Clone A fixed the submit handler; the redirect is next.'
    seed(a, fixLogin(update))
    pushThreads(a)

    const reply = await resumeOnce(b, 's1', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    assert.ok(resumed.briefing.includes(update), `B's briefing must hold A's update, got:\n${resumed.briefing}`)
    assert.ok(storedText(b).includes(update), "B's stored document must hold A's update")
  })
})

test('resume_thread.accepts-full-briefing', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const clone = cloneIn(makeDir, 'full-briefing')
    seed(clone, fixLogin(STAND))

    const [plain, withTrue, withFalse] = await resumeCalls(clone, 's1', [
      { thread_id: 'fix-login' },
      { thread_id: 'fix-login', full_briefing: true },
      { thread_id: 'fix-login', full_briefing: false }
    ])

    assert.ok(plain !== undefined && withTrue !== undefined && withFalse !== undefined, 'every call must have a reply')
    assertSucceeded(plain)
    assert.deepEqual(withTrue, plain)
    assert.deepEqual(withFalse, plain)
  })
})

test('resume_thread.flags-conflicts', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withDirs(async (makeDir) => {
    const a = cloneIn(makeDir, 'theirs')
    const b = cloneIn(makeDir, 'ours')
    linkOrigin(makeDir, [a, b])
    seed(b, fixLogin(STAND))
    pushThreads(b)
    fetchThreads(a)
    seed(a, fixLogin('Clone A says the submit handler is fixed.'))
    pushThreads(a)
    seed(b, fixLogin('Clone B says the submit handler still fails.'))

    const reply = await resumeOnce(b, 's1', { thread_id: 'fix-login' })

    const resumed = resumedOf(reply)
    assert.ok(
      storedText(b).split('\n').some((line) => line.startsWith('<<<<<<<')),
      `the stored document must hold conflict markers, got:\n${storedText(b)}`
    )
    assert.ok(
      resumed.recovery.includes(
        'Conflicts from the last sync are marked in the document; resolve them by editing the working copy.'
      ),
      `the recovery must hold the conflict line, got:\n${resumed.recovery.join('\n')}`
    )
  })
})
