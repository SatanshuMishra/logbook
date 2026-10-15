import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ulid } from 'ulid'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { writeHandover } from '../../src/thread/handover.ts'
import { foldHold, heldBy, readHold, takeHold } from '../../src/thread/holds.ts'
import { writeMarker } from '../../src/thread/inflight.ts'
import { findRepository, workingCopyPath, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime; workingCopy: string }

type HookOutput = Record<string, unknown>

type DocParts = { slug?: string; title?: string; status?: string; standing?: string; nextStep?: string }

const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const FOLDED_AT = new Date(Date.UTC(2026, 9, 14, 10, 0)).toISOString()
const CEILING = 9500

const GIT_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const timeAt = (offsetSeconds: number): string => new Date(Date.UTC(2026, 9, 14, 9, 0) + offsetSeconds * 1000).toISOString()

const secondsAgo = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString()

const stateDocument = (parts: DocParts = {}): string => {
  const lines = [
    `# ${parts.slug ?? 'fix-login'}: ${parts.title ?? 'Fix the login page'}`,
    `Status: ${parts.status ?? 'active'}`,
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D2 R1 S1',
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
    parts.standing ?? 'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    parts.nextStep ?? 'Fix the submit handler. Then rerun the login tests.',
    '',
    '## Decisions in force',
    '',
    '- D1 Keep the session cookie: the mobile app reads it',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md'
  ]
  return `${lines.join('\n')}\n`
}

const FILLER = 'Progress note. '

const documentOfLength = (length: number): string => {
  const room = length - stateDocument({ standing: '' }).length
  const text = stateDocument({ standing: FILLER.repeat(Math.ceil(room / FILLER.length)).slice(0, room) })
  assert.equal(text.length, length)
  return text
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

const refExists = (repo: string, ref: string): boolean => rawGit(repo, ['rev-parse', '--verify', '--quiet', ref]).status === 0

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-session-start-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-session-start-home-'))
  try {
    initRepo(repo)
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 's1' })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const workingCopy = workingCopyPath(found.value, 'fix-login')
    assert.ok(workingCopy.ok, 'the working copy path must be built')
    await fn({ repo, home, paths: found.value, rt, workingCopy: workingCopy.value })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const seedThreads = (fixture: Fixture, documents: Record<string, string>): void => {
  const seeded = commitDocuments(fixture.rt, fixture.paths, {
    changes: Object.entries(documents).map(([slug, text]) => ({ slug, text, expectedBlob: null })),
    message: 'open_thread: seeded'
  })
  assert.ok(seeded.ok, 'the stored documents must be seeded')
}

const transcriptOf = (fixture: Fixture, session: string): string => join(fixture.home, 'transcripts', `${session}.jsonl`)

const bashCall = (id: string, command: string, at: string): Record<string, unknown> => ({
  type: 'assistant',
  timestamp: at,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] }
})

const writeTranscript = (file: string, entries: readonly Record<string, unknown>[]): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

const markBash = (fixture: Fixture, toolUseId: string, command: string, session: string): void => {
  const written = writeMarker(fixture.rt, fixture.paths, 'fix-login', {
    toolUseId,
    tool: 'Bash',
    toolInput: { command },
    session
  })
  assert.ok(written, `the marker ${toolUseId} must be written`)
}

const startEvent = (
  fixture: Fixture,
  session: string,
  source: string,
  transcript: string = transcriptOf(fixture, session)
): Record<string, unknown> => ({
  session_id: session,
  transcript_path: transcript,
  cwd: fixture.repo,
  hook_event_name: 'SessionStart',
  source
})

const runStart = async (fixture: Fixture, event: Record<string, unknown>): Promise<{ stdout: string; output: HookOutput }> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook: 'session-start', event, env: { HOME: fixture.home } })
  assert.equal(run.code, 0, run.stderr)
  const output: unknown = JSON.parse(run.stdout)
  assert.ok(isRecord(output), `the hook must print a JSON object, got ${run.stdout}`)
  return { stdout: run.stdout, output }
}

const contextOf = (output: HookOutput): string => {
  const specific = output.hookSpecificOutput
  assert.ok(isRecord(specific), 'the output must carry hookSpecificOutput')
  assert.equal(specific.hookEventName, 'SessionStart')
  assert.equal(typeof specific.additionalContext, 'string')
  return String(specific.additionalContext)
}

const openingOf = (fixture: Fixture): string =>
  `Logbook: this session holds thread fix-login. Its state document follows and is now in your context; do not print it. Keep it true by editing ${fixture.workingCopy} when logbook asks.`

const userLineOf = (fixture: Fixture): string =>
  `Logbook: Fix the login page - active. Next: Fix the submit handler. Full state: ${fixture.workingCopy}`

const handoverFile = (fixture: Fixture, session: string): string =>
  join(fixture.paths.logbookDir, 'handover', `${session}.json`)

const redirectFile = (fixture: Fixture, session: string): string =>
  join(fixture.paths.logbookDir, 'sessions', `${session}.json`)

const activityCommand = (index: number): string => `echo act-${String(index).padStart(3, '0')}`.padEnd(34, '.')

const activityEntries = (count: number): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, index) => bashCall(`toolu_a${index}`, activityCommand(index), timeAt(60 + index)))

const activityLines = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `Bash: ${activityCommand(index)}`)

const jobCommand = (index: number): string => `npm run job-${String(index).padStart(2, '0')}`

const markJobs = (fixture: Fixture, count: number): string[] =>
  Array.from({ length: count }, (_, index) => {
    markBash(fixture, `toolu_m${index}`, jobCommand(index), 's0')
    return `Bash: ${jobCommand(index)}`
  })

const linesStarting = (context: string, prefix: string): string[] =>
  context.split('\n').filter((line) => line.startsWith(prefix))

test('session-start.startup-gives-the-roster', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, {
      alpha: stateDocument({ slug: 'alpha', title: 'Build the parser', nextStep: 'Write the parser. Then test it.' }),
      beta: stateDocument({ slug: 'beta', title: 'Ship the release', nextStep: 'Ship the release.' })
    })
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'startup'))
    const context = contextOf(output)
    assert.ok(context.includes('alpha - active - Next: Write the parser.'), context)
    assert.ok(context.includes('beta - active - Next: Ship the release.'), context)
    assert.ok(context.includes('To continue a thread, call resume_thread with its slug.'), context)
    assert.equal('systemMessage' in output, false)
  })
})

test('session-start.startup-migrates-an-old-ledger', async () => {
  await withFixture(async (fixture) => {
    const thread = {
      id: ulid(),
      slug: 'fix-login',
      title: 'Fix the login flow',
      status: 'open',
      blocked_by: null,
      created_at: STORED_AT,
      updated_at: STORED_AT,
      completion_criteria: [],
      artifacts: [],
      spine: {
        active_goal: 'Users can sign in again',
        next_step: 'Write the refresh handler',
        landed: '',
        last_session: '',
        open_risks: [],
        key_decisions: [],
        out_of_scope: []
      }
    }
    const blob = gitWithInput(fixture.repo, ['hash-object', '-w', '--stdin'], JSON.stringify(thread, null, 2))
    const threads = gitWithInput(fixture.repo, ['mktree'], `100644 blob ${blob}\t${thread.id}.json\n`)
    const root = gitWithInput(fixture.repo, ['mktree'], `040000 tree ${threads}\tthreads\n`)
    const commit = gitWithInput(fixture.repo, ['commit-tree', root, '-m', 'old ledger'], '')
    mustGit(fixture.repo, ['update-ref', 'refs/logbook/ledger', commit])
    assert.equal(refExists(fixture.repo, 'refs/logbook/threads'), false)
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'startup'))
    assert.equal(refExists(fixture.repo, 'refs/logbook/threads'), true)
    const context = contextOf(output)
    assert.ok(context.includes('fix-login - active - Next: Write the refresh handler'), context)
  })
})

test('session-start.startup-without-threads-is-quiet', async () => {
  await withFixture(async (fixture) => {
    const { stdout } = await runStart(fixture, startEvent(fixture, 's1', 'startup'))
    assert.equal(stdout, '{}')
  })
})

test('session-start.resume-gives-the-document', async () => {
  await withFixture(async (fixture) => {
    const document = stateDocument()
    seedThreads(fixture, { 'fix-login': document })
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    const transcript = transcriptOf(fixture, 's1')
    writeTranscript(transcript, [bashCall('toolu_r1', 'npm test -- login', timeAt(120))])
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'resume'))
    const context = contextOf(output)
    assert.ok(context.startsWith(openingOf(fixture)), context)
    assert.ok(context.includes(document.trimEnd()), context)
    assert.ok(context.includes('Activity since the last update:\nBash: npm test -- login'), context)
    assert.equal(output.systemMessage, userLineOf(fixture))
    assert.deepEqual(readHold(fixture.paths, 'fix-login')?.transcripts, [transcript])
  })
})

test('session-start.compact-gives-the-document-and-markers', async () => {
  await withFixture(async (fixture) => {
    const document = stateDocument()
    seedThreads(fixture, { 'fix-login': document })
    const transcript = transcriptOf(fixture, 's1')
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', transcript)
    foldHold(fixture.rt, fixture.paths, 'fix-login', FOLDED_AT)
    writeTranscript(transcript, [
      bashCall('toolu_c1', 'git status --short', timeAt(1800)),
      bashCall('toolu_c2', 'npm run build', timeAt(5400))
    ])
    markBash(fixture, 'toolu_e1', 'npm run e2e', 's0')
    markBash(fixture, 'toolu_l1', 'npm run lint', 's1')
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'compact'))
    const context = contextOf(output)
    assert.ok(context.startsWith(openingOf(fixture)), context)
    assert.ok(context.includes(document.trimEnd()), context)
    assert.ok(context.includes('Bash: npm run build'), context)
    assert.equal(context.includes('Bash: git status --short'), false)
    assert.ok(context.includes('Was running when the session ended:\nBash: npm run e2e'), context)
    assert.equal(context.includes('Bash: npm run lint'), false)
    assert.equal(output.systemMessage, userLineOf(fixture))
  })
})

test('session-start.clear-gives-the-document-after-handover', async () => {
  await withFixture(async (fixture) => {
    const document = stateDocument()
    seedThreads(fixture, { 'fix-login': document })
    const folder = join(fixture.home, 'P')
    const oldTranscript = join(folder, 's1.jsonl')
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', oldTranscript)
    writeTranscript(oldTranscript, [bashCall('toolu_h1', 'npm run migrate', timeAt(60))])
    writeHandover(fixture.rt, fixture.paths, {
      session: 's1',
      slug: 'fix-login',
      transcript: oldTranscript,
      at: secondsAgo(5)
    })
    const { output } = await runStart(fixture, startEvent(fixture, 's2', 'clear', join(folder, 's2.jsonl')))
    assert.equal(heldBy(fixture.paths, 's2'), 'fix-login')
    const context = contextOf(output)
    assert.ok(context.startsWith(openingOf(fixture)), context)
    assert.ok(context.includes(document.trimEnd()), context)
    assert.ok(context.includes('Bash: npm run migrate'), context)
    assert.equal(output.systemMessage, userLineOf(fixture))
  })
})

test('session-start.quiet-for-a-session-holding-nothing', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, { 'fix-login': stateDocument() })
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's9', null)
    for (const source of ['resume', 'compact', 'clear']) {
      const { stdout } = await runStart(fixture, startEvent(fixture, 's1', source))
      assert.equal(stdout, '{}', `source ${source}`)
    }
    assert.equal(heldBy(fixture.paths, 's1'), null)
    assert.equal(readHold(fixture.paths, 'fix-login')?.holder, 's9')
    assert.equal(existsSync(join(fixture.paths.logbookDir, 'sessions')), false)
  })
})

test('session-start.old-activity-gives-way-first', async () => {
  await withFixture(async (fixture) => {
    const document = documentOfLength(4000)
    seedThreads(fixture, { 'fix-login': document })
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    writeTranscript(transcriptOf(fixture, 's1'), activityEntries(300))
    const expectedActivity = activityLines(300)
    expectedActivity.forEach((line) => assert.equal(line.length, 40))
    markBash(fixture, 'toolu_e1', 'npm run e2e', 's0')
    markBash(fixture, 'toolu_e2', 'npm run deploy', 's0')
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'resume'))
    const context = contextOf(output)
    assert.ok(context.length <= CEILING, `context is ${context.length} characters`)
    assert.ok(context.startsWith(openingOf(fixture)), context)
    assert.ok(context.includes(document.trimEnd()))
    assert.ok(context.includes('Was running when the session ended:\nBash: npm run e2e\nBash: npm run deploy'), context)
    const kept = linesStarting(context, 'Bash: echo act-')
    assert.ok(kept.length > 0 && kept.length < 300, `kept ${kept.length} activity lines`)
    assert.deepEqual(kept, expectedActivity.slice(300 - kept.length))
    assert.ok(context.includes(`(${300 - kept.length} earlier lines left out)`), context)
    assert.equal(typeof output.systemMessage, 'string')
  })
})

test('session-start.markers-give-way-after-activity', async () => {
  await withFixture(async (fixture) => {
    const document = documentOfLength(9000)
    seedThreads(fixture, { 'fix-login': document })
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    writeTranscript(transcriptOf(fixture, 's1'), activityEntries(50))
    const markerLines = markJobs(fixture, 30)
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'resume'))
    const context = contextOf(output)
    assert.ok(context.length <= CEILING, `context is ${context.length} characters`)
    assert.ok(context.startsWith(openingOf(fixture)), context)
    assert.ok(context.includes(document.trimEnd()))
    assert.ok(context.includes('(50 earlier lines left out)'), context)
    assert.deepEqual(linesStarting(context, 'Bash: echo act-'), [])
    const kept = linesStarting(context, 'Bash: npm run job-')
    const left = 30 - kept.length
    assert.ok(kept.length > 0 && left > 1, `kept ${kept.length} marker lines`)
    assert.deepEqual(kept, markerLines.slice(left))
    assert.ok(context.includes(`(${left} running tools left out)`), context)
    const nextOlder = markerLines[left - 1] ?? ''
    const grown = context.length + nextOlder.length + 1 - String(left).length + String(left - 1).length
    assert.ok(grown > CEILING, `one more marker line would still fit: ${grown}`)
    assert.equal(typeof output.systemMessage, 'string')
  })
})

test('session-start.too-long-document-is-read-from-the-file', async () => {
  await withFixture(async (fixture) => {
    const document = documentOfLength(12000)
    seedThreads(fixture, { 'fix-login': document })
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    writeTranscript(transcriptOf(fixture, 's1'), activityEntries(20))
    markJobs(fixture, 3)
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'resume'))
    const context = contextOf(output)
    assert.ok(context.length <= CEILING, `context is ${context.length} characters`)
    assert.ok(context.startsWith(openingOf(fixture)), context)
    assert.ok(context.includes('# fix-login: Fix the login page\nStatus: active'), context)
    assert.ok(context.includes('## Next step\n\nFix the submit handler. Then rerun the login tests.'), context)
    assert.ok(context.includes(`The document is too long to include; Read ${fixture.workingCopy} now.`), context)
    assert.ok(context.includes('(20 earlier lines left out)'), context)
    assert.ok(context.includes('(3 running tools left out)'), context)
    assert.deepEqual(linesStarting(context, 'Bash: '), [])
    assert.equal(context.includes(FILLER.trim()), false)
    assert.equal(typeof output.systemMessage, 'string')
  })
})

test('session-start.kept-lines-are-cut-when-too-long', async () => {
  await withFixture(async (fixture) => {
    const title = 'Fix the login page for every user. '.repeat(100).slice(0, 3000)
    const reason = 'waiting on the identity team. '.repeat(200).slice(0, 5000)
    const nextStep = 'Fix the submit handler and rerun the tests. '.repeat(200).slice(0, 8000 - '## Next step\n\n'.length)
    assert.equal(title.length, 3000)
    assert.equal(reason.length, 5000)
    assert.equal(`## Next step\n\n${nextStep}`.length, 8000)
    seedThreads(fixture, { 'fix-login': stateDocument({ title, status: `blocked: ${reason}`, nextStep }) })
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    const { output } = await runStart(fixture, startEvent(fixture, 's1', 'resume'))
    const context = contextOf(output)
    const titleLine = `${`# fix-login: ${title}`.slice(0, 497)}...`
    const statusLine = `${`Status: blocked: ${reason}`.slice(0, 497)}...`
    const nextStepSection = `${`## Next step\n\n${nextStep}`.slice(0, 1997)}...`
    assert.equal(titleLine.length, 500)
    assert.equal(statusLine.length, 500)
    assert.equal(nextStepSection.length, 2000)
    assert.ok(context.length <= CEILING, `context is ${context.length} characters`)
    assert.ok(context.startsWith(openingOf(fixture)), context)
    assert.ok(context.includes(`${titleLine}\n${statusLine}\n`), context)
    assert.ok(context.includes(`${nextStepSection}\n`), context)
    assert.ok(context.includes(`The document is too long to include; Read ${fixture.workingCopy} now.`), context)
    assert.equal(typeof output.systemMessage, 'string')
  })
})

test('handover.fresh-handover-passes-the-hold', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, { 'fix-login': stateDocument() })
    const folder = join(fixture.home, 'P')
    const oldTranscript = join(folder, 's1.jsonl')
    const newTranscript = join(folder, 's2.jsonl')
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', oldTranscript)
    writeHandover(fixture.rt, fixture.paths, {
      session: 's1',
      slug: 'fix-login',
      transcript: oldTranscript,
      at: secondsAgo(5)
    })
    await runStart(fixture, startEvent(fixture, 's2', 'clear', newTranscript))
    assert.equal(existsSync(handoverFile(fixture, 's1')), false)
    assert.equal(heldBy(fixture.paths, 's2'), 'fix-login')
    assert.deepEqual(readHold(fixture.paths, 'fix-login')?.transcripts, [oldTranscript, newTranscript])
    assert.deepEqual(JSON.parse(readFileSync(redirectFile(fixture, 's1'), 'utf8')), { session: 's2' })
  })
})

test('handover.fresh-handover-from-another-folder-is-left', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, { 'fix-login': stateDocument() })
    const oldTranscript = join(fixture.home, 'P', 's1.jsonl')
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', oldTranscript)
    writeHandover(fixture.rt, fixture.paths, {
      session: 's1',
      slug: 'fix-login',
      transcript: oldTranscript,
      at: secondsAgo(5)
    })
    const { stdout } = await runStart(fixture, startEvent(fixture, 's2', 'clear', join(fixture.home, 'Q', 's2.jsonl')))
    assert.equal(stdout, '{}')
    assert.ok(existsSync(handoverFile(fixture, 's1')))
    assert.equal(existsSync(join(fixture.paths.logbookDir, 'sessions')), false)
    assert.equal(heldBy(fixture.paths, 's2'), null)
    assert.equal(readHold(fixture.paths, 'fix-login')?.holder, 's1')
  })
})

test('handover.newest-of-two-fresh-handovers-is-taken', async () => {
  await withFixture(async (fixture) => {
    const folder = join(fixture.home, 'P')
    const alphaTranscript = join(folder, 's1.jsonl')
    const betaTranscript = join(folder, 's3.jsonl')
    takeHold(fixture.rt, fixture.paths, 'alpha', 's1', alphaTranscript)
    takeHold(fixture.rt, fixture.paths, 'beta', 's3', betaTranscript)
    writeHandover(fixture.rt, fixture.paths, {
      session: 's1',
      slug: 'alpha',
      transcript: alphaTranscript,
      at: secondsAgo(10)
    })
    writeHandover(fixture.rt, fixture.paths, {
      session: 's3',
      slug: 'beta',
      transcript: betaTranscript,
      at: secondsAgo(5)
    })
    await runStart(fixture, startEvent(fixture, 's2', 'clear', join(folder, 's2.jsonl')))
    assert.equal(heldBy(fixture.paths, 's2'), 'beta')
    assert.deepEqual(JSON.parse(readFileSync(redirectFile(fixture, 's3'), 'utf8')), { session: 's2' })
    assert.equal(existsSync(handoverFile(fixture, 's3')), false)
    assert.ok(existsSync(handoverFile(fixture, 's1')))
    assert.equal(existsSync(redirectFile(fixture, 's1')), false)
    assert.equal(readHold(fixture.paths, 'alpha')?.holder, 's1')
  })
})

test('handover.fresh-handover-without-a-thread-redirects-only', async () => {
  await withFixture(async (fixture) => {
    const folder = join(fixture.home, 'P')
    writeHandover(fixture.rt, fixture.paths, {
      session: 's1',
      slug: null,
      transcript: join(folder, 's1.jsonl'),
      at: secondsAgo(5)
    })
    const { stdout } = await runStart(fixture, startEvent(fixture, 's2', 'clear', join(folder, 's2.jsonl')))
    assert.equal(stdout, '{}')
    assert.equal(existsSync(handoverFile(fixture, 's1')), false)
    assert.deepEqual(JSON.parse(readFileSync(redirectFile(fixture, 's1'), 'utf8')), { session: 's2' })
    assert.equal(existsSync(join(fixture.paths.logbookDir, 'holds')), false)
  })
})

test('handover.old-handover-is-dropped', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, { 'fix-login': stateDocument() })
    const folder = join(fixture.home, 'P')
    const oldTranscript = join(folder, 's1.jsonl')
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', oldTranscript)
    writeHandover(fixture.rt, fixture.paths, {
      session: 's1',
      slug: 'fix-login',
      transcript: oldTranscript,
      at: secondsAgo(61)
    })
    const { stdout } = await runStart(fixture, startEvent(fixture, 's2', 'clear', join(folder, 's2.jsonl')))
    assert.equal(stdout, '{}')
    assert.equal(existsSync(handoverFile(fixture, 's1')), false)
    assert.equal(existsSync(join(fixture.paths.logbookDir, 'sessions')), false)
    assert.equal(heldBy(fixture.paths, 's2'), null)
  })
})

test('handover.clear-without-a-handover', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, { 'fix-login': stateDocument() })
    const { stdout } = await runStart(fixture, startEvent(fixture, 's2', 'clear', join(fixture.home, 'P', 's2.jsonl')))
    assert.equal(stdout, '{}')
    assert.equal(heldBy(fixture.paths, 's2'), null)
    assert.equal(existsSync(join(fixture.paths.logbookDir, 'sessions')), false)
  })
})
