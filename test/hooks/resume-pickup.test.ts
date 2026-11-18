import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { sessionStart } from '../../src/hook/session-start.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { readHold } from '../../src/thread/holds.ts'
import { findRepository, workingCopyPath, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments, makeCommit, moveRef, readDocument, writeTree } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; metrics: string; paths: RepoPaths; rt: Runtime }

type Line = Record<string, unknown>

const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const UNCHANGED = 'has not changed since this conversation last had it whole'
const OPENING = 'Logbook: this session holds thread work.'
const TITLE = '# work:'
const NEW_NEXT_STEP = 'Run the release checks for the work.'
const DAY_SECONDS = 24 * 60 * 60
const FILLER = 'Progress note. '
const STANDING_AFTER = 'The first part is built.'

const GIT_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (slug: string, nextStep = `Start the ${slug} work.`, standing = 'Nothing is built yet.'): string => {
  const lines = [
    `# ${slug}: Work on ${slug}`,
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    `The ${slug} work is finished.`,
    '',
    '## Done when',
    '',
    `- [ ] c1 The ${slug} work ships`,
    '',
    '## Where things stand',
    '',
    standing,
    '',
    '## Next step',
    '',
    nextStep,
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

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const sessionRuntime = (fixture: { repo: string; home: string; metrics: string }, session: string): Runtime =>
  testRuntime({
    cwd: fixture.repo,
    env: { PATH: process.env.PATH, HOME: fixture.home, PLUGIN_METRICS_DIR: fixture.metrics },
    sessionId: session
  })

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-resume-pickup-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-resume-pickup-home-'))
  const metrics = mkdtempSync(join(tmpdir(), 'logbook-resume-pickup-metrics-'))
  try {
    initRepo(repo)
    const rt = sessionRuntime({ repo, home, metrics }, 's1')
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(sessionRuntime({ repo, home, metrics }, 'seed'), found.value, {
      changes: [{ slug: 'work', text: stateDocument('work'), expectedBlob: null }],
      message: 'open_thread: seeded'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
    await fn({ repo, home, metrics, paths: found.value, rt })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(metrics, { recursive: true, force: true })
  }
}

const transcriptOf = (fixture: Fixture, session: string): string => join(fixture.home, 'transcripts', `${session}.jsonl`)

const start = (fixture: Fixture, session: string, source: string): string => {
  const output: unknown = sessionStart({
    event: {
      session_id: session,
      transcript_path: transcriptOf(fixture, session),
      cwd: fixture.repo,
      hook_event_name: 'SessionStart',
      source
    },
    sessionId: session,
    paths: fixture.paths,
    rt: fixture.rt
  })
  assert.ok(isRecord(output), 'sessionStart must return an object')
  const specific = output.hookSpecificOutput
  assert.ok(isRecord(specific), `the output must carry hookSpecificOutput, got ${JSON.stringify(output)}`)
  assert.equal(typeof specific.additionalContext, 'string')
  return String(specific.additionalContext)
}

const storedText = (fixture: Fixture): string => {
  const stored = readDocument(fixture.rt, fixture.paths, 'work')
  assert.ok(stored !== null, 'the stored document must be readable')
  return stored.text.replace(/\n+$/, '')
}

const commitAs = (fixture: Fixture, writer: string, text: string): void => {
  const stored = readDocument(fixture.rt, fixture.paths, 'work')
  assert.ok(stored !== null, 'the stored document must be readable')
  const committed = commitDocuments(sessionRuntime(fixture, writer), fixture.paths, {
    changes: [{ slug: 'work', text, expectedBlob: stored.blob }],
    message: `update_thread work: by ${writer}`
  })
  assert.ok(committed.ok, `the commit by ${writer} must land`)
}

const pickUpAtStartup = (fixture: Fixture): void => {
  const context = start(fixture, 's1', 'startup')
  assert.ok(context.includes(storedText(fixture)), context)
}

const threadsTip = (fixture: Fixture): string => mustGit(fixture.repo, ['rev-parse', THREADS_REF]).trim()

const commitWithDate = (fixture: Fixture, tree: string, parent: string, message: string, date: string): string => {
  const result = spawnSync('git', ['-C', fixture.repo, 'commit-tree', tree, '-p', parent], {
    env: { ...GIT_ENV, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
    encoding: 'utf8',
    input: message
  })
  assert.equal(result.status, 0, `git commit-tree failed: ${result.stderr}`)
  return result.stdout.trim()
}

const pickupLines = (fixture: Fixture): Line[] =>
  existsSync(fixture.metrics)
    ? readdirSync(fixture.metrics, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.jsonl') && basename(name).startsWith('work.'))
        .flatMap((name) =>
          readFileSync(join(fixture.metrics, name), 'utf8')
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as Line)
        )
        .filter((line) => line.event === 'thread.pickup')
    : []

const writeWorkingCopy = (fixture: Fixture, text: string): void => {
  const file = workingCopyPath(fixture.paths, 'work')
  assert.ok(file.ok, 'the working copy path must be built')
  mkdirSync(dirname(file.value), { recursive: true })
  writeFileSync(file.value, text)
}

test('resume-pickup.unchanged-document-gets-one-line', async () => {
  await withFixture(async (fixture) => {
    pickUpAtStartup(fixture)
    const resumed = start(fixture, 's1', 'resume')
    assert.ok(resumed.startsWith(OPENING), resumed)
    assert.ok(resumed.includes(UNCHANGED), resumed)
    assert.ok(!resumed.includes(TITLE), resumed)
    const compacted = start(fixture, 's1', 'compact')
    assert.ok(compacted.includes(storedText(fixture)), compacted)
  })
})

test('resume-pickup.own-change-gets-one-line', async () => {
  await withFixture(async (fixture) => {
    pickUpAtStartup(fixture)
    commitAs(fixture, 's1', stateDocument('work', NEW_NEXT_STEP))
    const resumed = start(fixture, 's1', 'resume')
    assert.ok(resumed.startsWith(OPENING), resumed)
    assert.ok(!resumed.includes(NEW_NEXT_STEP), resumed)
  })
})

test('resume-pickup.another-writers-change-gets-the-document', async () => {
  await withFixture(async (fixture) => {
    pickUpAtStartup(fixture)
    const first = start(fixture, 's1', 'resume')
    assert.ok(!first.includes(TITLE), first)
    commitAs(fixture, 's2', stateDocument('work', NEW_NEXT_STEP))
    const second = start(fixture, 's1', 'resume')
    assert.ok(second.includes(storedText(fixture)), second)
    assert.ok(second.includes(NEW_NEXT_STEP), second)
  })
})

test('resume-pickup.working-copy-difference-gets-the-document', async () => {
  await withFixture(async (fixture) => {
    pickUpAtStartup(fixture)
    const first = start(fixture, 's1', 'resume')
    assert.ok(!first.includes(TITLE), first)
    writeWorkingCopy(fixture, stateDocument('work', NEW_NEXT_STEP))
    const second = start(fixture, 's1', 'resume')
    assert.ok(second.includes('Logbook has not committed it'), second)
    assert.ok(second.includes(`${TITLE} Work on work`), second)
  })
})

test('resume-pickup.unchanged-pickup-is-recorded', async () => {
  await withFixture(async (fixture) => {
    pickUpAtStartup(fixture)
    const resumed = start(fixture, 's1', 'resume')
    const unchanged = pickupLines(fixture).filter((line) => line.source === 'resume')
    assert.equal(unchanged.length, 1, JSON.stringify(pickupLines(fixture)))
    assert.equal(unchanged[0]?.delivered, 'unchanged')
    assert.equal(unchanged[0]?.activity_lines, 0)
    assert.equal(unchanged[0]?.context_chars, resumed.length)
  })
})

test('resume-pickup.short-pickup-clears-received', async () => {
  await withFixture(async (fixture) => {
    pickUpAtStartup(fixture)
    assert.equal(readHold(fixture.paths, 'work')?.received?.session, 's1')
    const long = stateDocument('work', 'Start the work work.', FILLER.repeat(700).trim())
    assert.ok(long.length > 9500, `the document is ${long.length} characters`)
    commitAs(fixture, 's1', long)
    const compacted = start(fixture, 's1', 'compact')
    assert.ok(!compacted.includes(storedText(fixture)), 'the compact pickup must send the short form')
    const hold = readHold(fixture.paths, 'work')
    assert.ok(hold !== null, 'the hold must still exist')
    assert.equal('received' in hold, false, JSON.stringify(hold))
    const resumed = start(fixture, 's1', 'resume')
    assert.ok(!resumed.includes(UNCHANGED), resumed)
  })
})

test('resume-pickup.merged-in-change-gets-the-document', async () => {
  await withFixture(async (fixture) => {
    const forkPoint = threadsTip(fixture)
    commitAs(fixture, 'seed', stateDocument('work', 'Start the work work.', STANDING_AFTER))
    pickUpAtStartup(fixture)
    const received = readHold(fixture.paths, 'work')?.received
    const tip = threadsTip(fixture)
    assert.deepEqual(received, { session: 's1', commit: tip })
    const tipSeconds = Number(mustGit(fixture.repo, ['log', '-1', '--format=%ct', tip]).trim())
    const side = commitWithDate(
      fixture,
      writeTree(fixture.rt, fixture.paths, { 'work.md': stateDocument('work', NEW_NEXT_STEP) }),
      forkPoint,
      'update_thread work: from another clone\n\nWriter: s2\n',
      `@${tipSeconds - DAY_SECONDS} +0000`
    )
    const merge = makeCommit(
      fixture.rt,
      fixture.paths,
      writeTree(fixture.rt, fixture.paths, { 'work.md': stateDocument('work', NEW_NEXT_STEP, STANDING_AFTER) }),
      [tip, side],
      'sync: merge the threads of origin'
    )
    assert.ok(merge.ok, 'the merge commit must be made')
    const moved = moveRef(fixture.rt, fixture.paths, merge.value, tip)
    assert.ok(moved.ok, 'the threads ref must move to the merge')
    const resumed = start(fixture, 's1', 'resume')
    assert.ok(resumed.includes(storedText(fixture)), resumed)
    assert.ok(resumed.includes(NEW_NEXT_STEP), resumed)
    assert.ok(!resumed.includes(UNCHANGED), resumed)
  })
})
