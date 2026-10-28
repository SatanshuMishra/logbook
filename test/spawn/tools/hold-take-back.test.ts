import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { sessionStart } from '../../../src/hook/session-start.ts'
import { takeHold } from '../../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer } from '../../support/spawn-client.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime }

type HoldJson = Record<string, unknown>

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const SESSION = 'server-session'
const OTHER_SESSION = 'other-session'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const SLUGS = ['alpha', 'beta', 'gamma'] as const

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

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-take-back-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-take-back-home-'))
  try {
    mustGit(repo, ['init', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
    mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
    const rt = testRuntime({ start: new Date().toISOString(), cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 'seed' })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: SLUGS.map((slug) => ({ slug, text: stateDocument(slug), expectedBlob: null })),
      message: 'open_thread: seeded'
    })
    assert.ok(seeded.ok, 'the stored documents must be seeded')
    await fn({ repo, home, paths: found.value, rt })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const holdsFolder = (fixture: Fixture): string => join(fixture.paths.commonDir, 'logbook', 'holds')

const holdFile = (fixture: Fixture, slug: string): string => join(holdsFolder(fixture), `${slug}.json`)

const writeHoldJson = (fixture: Fixture, slug: string, holder: string | null, processId: number | null, releasedFrom: string | null): void => {
  const file = holdFile(fixture, slug)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify({ slug, holder, transcripts: [], folded_at: null, nudged_prompt_id: null, process: processId, released_from: releasedFrom })
  )
}

const readHoldJson = (fixture: Fixture, slug: string): HoldJson => {
  const parsed: unknown = JSON.parse(readFileSync(holdFile(fixture, slug), 'utf8'))
  assert.ok(isRecord(parsed), `the hold ${slug}.json must hold an object`)
  return parsed
}

const slugsHeldBy = (fixture: Fixture, session: string): string[] =>
  readdirSync(holdsFolder(fixture))
    .filter((name) => name.endsWith('.json'))
    .map((name) => readHoldJson(fixture, name.slice(0, -'.json'.length)))
    .filter((hold) => hold.holder === session)
    .map((hold) => String(hold.slug))
    .sort()

const exitedProcess = (fixture: Fixture): number => {
  const child = spawnSync(process.execPath, ['-e', ''], { env: { HOME: fixture.home } })
  assert.equal(child.status, 0, 'the short-lived child process must exit cleanly')
  assert.equal(typeof child.pid, 'number', 'the short-lived child process must have a process id')
  return child.pid as number
}

const runStart = (fixture: Fixture, session: string, source: string): Record<string, unknown> => {
  const output: unknown = sessionStart({
    event: {
      session_id: session,
      transcript_path: join(fixture.home, 'transcripts', `${session}.jsonl`),
      cwd: fixture.repo,
      hook_event_name: 'SessionStart',
      source
    },
    sessionId: session,
    paths: fixture.paths,
    rt: fixture.rt
  })
  assert.ok(isRecord(output), 'sessionStart must return an object')
  return output
}

const contextOf = (output: Record<string, unknown>): string => {
  const specific = output.hookSpecificOutput
  assert.ok(isRecord(specific), `the output must carry hookSpecificOutput, got ${JSON.stringify(output)}`)
  assert.equal(typeof specific.additionalContext, 'string')
  return String(specific.additionalContext)
}

const startServer = async (fixture: Fixture): Promise<void> => {
  const spawned = await spawnServer({
    projectRoot: fixture.repo,
    entry: ENTRY,
    env: { CLAUDE_CODE_SESSION_ID: SESSION, HOME: fixture.home }
  })
  try {
    const reply = (await spawned.client.callTool({ name: 'list_threads', arguments: {} })) as CallToolResult
    assert.equal(reply.isError, undefined, `expected list_threads to succeed, got: ${JSON.stringify(reply)}`)
  } finally {
    await spawned.close()
  }
}

test('S1: a compact start takes back the hold released from its session', async () => {
  await withFixture(async (fixture) => {
    writeHoldJson(fixture, 'alpha', SESSION, exitedProcess(fixture), null)
    runStart(fixture, OTHER_SESSION, 'startup')
    assert.equal(readHoldJson(fixture, 'alpha').released_from, SESSION, 'the other startup must release the live hold')
    const context = contextOf(runStart(fixture, SESSION, 'compact'))
    assert.ok(context.startsWith('Logbook: this session holds thread alpha.'), context)
    assert.equal(readHoldJson(fixture, 'alpha').holder, SESSION)
  })
})

test('S1: a starting server takes back the hold released from its session and records its parent process', async () => {
  await withFixture(async (fixture) => {
    writeHoldJson(fixture, 'alpha', null, null, SESSION)
    await startServer(fixture)
    const alpha = readHoldJson(fixture, 'alpha')
    assert.equal(alpha.holder, SESSION, `alpha.json must be taken back, got ${JSON.stringify(alpha)}`)
    assert.equal(alpha.process, process.pid, `alpha.json must record the server parent process, got ${JSON.stringify(alpha)}`)
    assert.equal(alpha.released_from, null, `alpha.json must no longer name a release, got ${JSON.stringify(alpha)}`)
  })
})

test('C2: a hold taken back with the server started before the resume hook keeps the server process', async () => {
  await withFixture(async (fixture) => {
    writeHoldJson(fixture, 'alpha', null, null, SESSION)
    await startServer(fixture)
    runStart(fixture, SESSION, 'resume')
    const alpha = readHoldJson(fixture, 'alpha')
    assert.equal(alpha.holder, SESSION, `alpha.json must be held by ${SESSION}, got ${JSON.stringify(alpha)}`)
    assert.equal(alpha.process, process.pid, `alpha.json must record the server parent process, got ${JSON.stringify(alpha)}`)
  })
})

test('C1: a resume start of a session that holds a thread takes back nothing', async () => {
  await withFixture(async (fixture) => {
    writeHoldJson(fixture, 'alpha', null, null, SESSION)
    writeHoldJson(fixture, 'beta', SESSION, process.pid, null)
    const context = contextOf(runStart(fixture, SESSION, 'resume'))
    assert.deepEqual(slugsHeldBy(fixture, SESSION), ['beta'])
    assert.equal(readHoldJson(fixture, 'alpha').holder, null)
    assert.ok(context.startsWith('Logbook: this session holds thread beta.'), context)
  })
})

test('C1: taking a hold clears the release markers of the taking session', async () => {
  await withFixture(async (fixture) => {
    writeHoldJson(fixture, 'alpha', SESSION, exitedProcess(fixture), null)
    runStart(fixture, OTHER_SESSION, 'startup')
    assert.equal(readHoldJson(fixture, 'alpha').released_from, SESSION, 'the other startup must release alpha')
    takeHold(fixture.rt, fixture.paths, 'beta', SESSION, null, process.pid)
    const alpha = readHoldJson(fixture, 'alpha')
    assert.equal(alpha.released_from, null, `alpha.json must lose its release marker, got ${JSON.stringify(alpha)}`)
    runStart(fixture, SESSION, 'resume')
    assert.deepEqual(slugsHeldBy(fixture, SESSION), ['beta'])
  })
})

test('C1: a resume start takes back only one of two holds released from its session', async () => {
  await withFixture(async (fixture) => {
    writeHoldJson(fixture, 'alpha', null, null, SESSION)
    writeHoldJson(fixture, 'gamma', null, null, SESSION)
    runStart(fixture, SESSION, 'resume')
    assert.equal(slugsHeldBy(fixture, SESSION).length, 1, `exactly one hold must be held, got ${slugsHeldBy(fixture, SESSION).join(', ')}`)
  })
})
