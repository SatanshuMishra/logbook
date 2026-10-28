import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { writeHandover } from '../../src/thread/handover.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime; startMs: number }

type HoldJson = Record<string, unknown>

const THREADS_REF = 'refs/logbook/threads'
const HOUR_MS = 60 * 60 * 1000
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (slug: string): string => {
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
    'Nothing is built yet.',
    '',
    '## Next step',
    '',
    `Start the ${slug} work.`,
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

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-hold-liveness-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-hold-liveness-home-'))
  try {
    initRepo(repo)
    const start = new Date().toISOString()
    const rt = testRuntime({ start, cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 'seed' })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    await fn({ repo, home, paths: found.value, rt, startMs: Date.parse(start) })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const seedThreads = (fixture: Fixture, slugs: readonly string[]): void => {
  const seeded = commitDocuments(fixture.rt, fixture.paths, {
    changes: slugs.map((slug) => ({ slug, text: stateDocument(slug), expectedBlob: null })),
    message: 'open_thread: seeded'
  })
  assert.ok(seeded.ok, 'the stored documents must be seeded')
}

const holdFile = (fixture: Fixture, slug: string): string => join(fixture.paths.commonDir, 'logbook', 'holds', `${slug}.json`)

const writeHoldJson = (fixture: Fixture, slug: string, hold: HoldJson): void => {
  const file = holdFile(fixture, slug)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(hold))
}

const readHoldJson = (fixture: Fixture, slug: string): HoldJson => {
  const parsed: unknown = JSON.parse(readFileSync(holdFile(fixture, slug), 'utf8'))
  assert.ok(isRecord(parsed), `the hold ${slug}.json must hold an object`)
  return parsed
}

const newHold = (slug: string, holder: string | null, processId: number | null, releasedFrom: string | null): HoldJson => ({
  slug,
  holder,
  transcripts: [],
  folded_at: null,
  nudged_prompt_id: null,
  process: processId,
  released_from: releasedFrom
})

const exitedProcess = (fixture: Fixture): number => {
  const child = spawnSync(process.execPath, ['-e', ''], { env: { HOME: fixture.home } })
  assert.equal(child.status, 0, 'the short-lived child process must exit cleanly')
  assert.equal(typeof child.pid, 'number', 'the short-lived child process must have a process id')
  return child.pid as number
}

const threadsTip = (fixture: Fixture): string => mustGit(fixture.repo, ['rev-parse', THREADS_REF]).trim()

const transcriptAged = (fixture: Fixture, name: string, ageMs: number): string => {
  const file = join(fixture.home, 'transcripts', `${name}.jsonl`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '{}\n')
  const changedAt = new Date(fixture.startMs - ageMs)
  utimesSync(file, changedAt, changedAt)
  return file
}

const startEvent = (fixture: Fixture, session: string, source: string, transcript: string): Record<string, unknown> => ({
  session_id: session,
  transcript_path: transcript,
  cwd: fixture.repo,
  hook_event_name: 'SessionStart',
  source
})

const runStart = async (fixture: Fixture, session: string, event: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const { sessionStart } = await import('../../src/hook/session-start.ts')
  const output: unknown = sessionStart({ event, sessionId: session, paths: fixture.paths, rt: fixture.rt })
  assert.ok(isRecord(output), 'sessionStart must return an object')
  return output
}

const contextOf = (output: Record<string, unknown>): string => {
  const specific = output.hookSpecificOutput
  assert.ok(isRecord(specific), `the output must carry hookSpecificOutput, got ${JSON.stringify(output)}`)
  assert.equal(typeof specific.additionalContext, 'string')
  return String(specific.additionalContext)
}

const unusedTranscript = (fixture: Fixture, session: string): string => join(fixture.home, 'transcripts', `${session}.jsonl`)

test('only the hold whose session process has ended is released at a startup', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, ['alpha', 'beta'])
    const alpha = newHold('alpha', 'ended-session', exitedProcess(fixture), null)
    writeHoldJson(fixture, 'alpha', alpha)
    writeHoldJson(fixture, 'beta', newHold('beta', 'live-session', process.pid, null))
    const betaBefore = readFileSync(holdFile(fixture, 'beta'), 'utf8')
    const tipBefore = threadsTip(fixture)
    await runStart(fixture, 'new-session', startEvent(fixture, 'new-session', 'startup', unusedTranscript(fixture, 'new-session')))
    assert.deepEqual(readHoldJson(fixture, 'alpha'), {
      slug: 'alpha',
      holder: null,
      transcripts: [],
      folded_at: null,
      nudged_prompt_id: null,
      process: null,
      released_from: 'ended-session'
    })
    assert.equal(readFileSync(holdFile(fixture, 'beta'), 'utf8'), betaBefore)
    assert.equal(threadsTip(fixture), tipBefore)
  })
})

test('a resume start keeps its own hold and releases another ended one', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, ['alpha', 'beta'])
    writeHoldJson(fixture, 'alpha', newHold('alpha', 'resumed-session', exitedProcess(fixture), null))
    writeHoldJson(fixture, 'beta', newHold('beta', 'ended-session', exitedProcess(fixture), null))
    const output = await runStart(
      fixture,
      'resumed-session',
      startEvent(fixture, 'resumed-session', 'resume', unusedTranscript(fixture, 'resumed-session'))
    )
    assert.equal(readHoldJson(fixture, 'alpha').holder, 'resumed-session')
    const beta = readHoldJson(fixture, 'beta')
    assert.equal(beta.holder, null, `beta.json must be released, got ${JSON.stringify(beta)}`)
    assert.equal(beta.released_from, 'ended-session', `beta.json must name the ended holder, got ${JSON.stringify(beta)}`)
    const context = contextOf(output)
    assert.ok(context.startsWith('Logbook: this session holds thread alpha.'), context)
  })
})

test('a resume start takes back the hold released from its own session', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, ['alpha', 'beta'])
    writeHoldJson(fixture, 'alpha', newHold('alpha', null, null, 'resumed-session'))
    writeHoldJson(fixture, 'beta', newHold('beta', 'other-session', process.pid, 'resumed-session'))
    const output = await runStart(
      fixture,
      'resumed-session',
      startEvent(fixture, 'resumed-session', 'resume', unusedTranscript(fixture, 'resumed-session'))
    )
    const alpha = readHoldJson(fixture, 'alpha')
    assert.equal(alpha.holder, 'resumed-session', `alpha.json must be taken back, got ${JSON.stringify(alpha)}`)
    assert.equal(alpha.released_from, null, `alpha.json must no longer name a release, got ${JSON.stringify(alpha)}`)
    assert.equal(readHoldJson(fixture, 'beta').holder, 'other-session')
    const context = contextOf(output)
    assert.ok(context.startsWith('Logbook: this session holds thread alpha.'), context)
  })
})

test('a hold from an earlier release is released only when every transcript it names is over 24 hours old', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'])
    const earlierHold = (slug: string, holder: string, transcripts: readonly string[]): HoldJson => ({
      slug,
      holder,
      transcripts: [...transcripts],
      folded_at: null,
      nudged_prompt_id: null
    })
    const old = 25 * HOUR_MS
    const recent = HOUR_MS
    writeHoldJson(fixture, 'alpha', earlierHold('alpha', 'old-a', [transcriptAged(fixture, 'old-a', old)]))
    writeHoldJson(fixture, 'beta', earlierHold('beta', 'old-b', [transcriptAged(fixture, 'old-b', recent)]))
    writeHoldJson(fixture, 'gamma', earlierHold('gamma', 'old-c', []))
    writeHoldJson(
      fixture,
      'delta',
      earlierHold('delta', 'old-d', [transcriptAged(fixture, 'old-d-1', old), transcriptAged(fixture, 'old-d-2', recent)])
    )
    writeHoldJson(fixture, 'epsilon', earlierHold('epsilon', 'old-e', [join(fixture.home, 'transcripts', 'missing.jsonl')]))
    writeHoldJson(fixture, 'zeta', { ...earlierHold('zeta', 'old-z', [transcriptAged(fixture, 'old-z', old)]), process: 0 })
    writeHoldJson(fixture, 'eta', { ...earlierHold('eta', 'old-h', [transcriptAged(fixture, 'old-h', old)]), process: -1 })
    await runStart(fixture, 'new-session', startEvent(fixture, 'new-session', 'startup', unusedTranscript(fixture, 'new-session')))
    const outcome = Object.fromEntries(
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'].map((slug) => {
        const hold = readHoldJson(fixture, slug)
        return [slug, { holder: hold.holder, released_from: hold.released_from ?? null }]
      })
    )
    assert.deepEqual(outcome, {
      alpha: { holder: null, released_from: 'old-a' },
      beta: { holder: 'old-b', released_from: null },
      gamma: { holder: 'old-c', released_from: null },
      delta: { holder: 'old-d', released_from: null },
      epsilon: { holder: 'old-e', released_from: null },
      zeta: { holder: null, released_from: 'old-z' },
      eta: { holder: null, released_from: 'old-h' }
    })
  })
})

test('a clear handover keeps the hold recorded process', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, ['alpha'])
    const folder = join(fixture.home, 'P')
    const oldTranscript = join(folder, 'old-session.jsonl')
    mkdirSync(folder, { recursive: true })
    writeFileSync(oldTranscript, '{}\n')
    writeHoldJson(fixture, 'alpha', { ...newHold('alpha', 'old-session', process.pid, null), transcripts: [oldTranscript] })
    writeHandover(fixture.rt, fixture.paths, {
      session: 'old-session',
      slug: 'alpha',
      transcript: oldTranscript,
      at: new Date(fixture.startMs - 5000).toISOString()
    })
    await runStart(fixture, 'new-session', startEvent(fixture, 'new-session', 'clear', join(folder, 'new-session.jsonl')))
    const alpha = readHoldJson(fixture, 'alpha')
    assert.equal(alpha.holder, 'new-session', `alpha.json must pass to the new session, got ${JSON.stringify(alpha)}`)
    assert.equal(alpha.process, process.pid, `alpha.json must keep its recorded process, got ${JSON.stringify(alpha)}`)
  })
})
