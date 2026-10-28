import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const SESSION = 'server-session'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime }

type HoldJson = Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const alphaDocument = (): string => {
  const lines = [
    '# alpha: Work on alpha',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    'The alpha work is finished.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The alpha work ships',
    '',
    '## Where things stand',
    '',
    'Nothing is built yet.',
    '',
    '## Next step',
    '',
    'Start the alpha work.',
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
  const repo = mkdtempSync(join(tmpdir(), 'logbook-hold-process-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-hold-process-home-'))
  try {
    mustGit(repo, ['init', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
    mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 'seed', start: STORED_AT })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    await fn({ repo, home, paths: found.value, rt })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const seedAlpha = (fixture: Fixture): void => {
  const seeded = commitDocuments(fixture.rt, fixture.paths, {
    changes: [{ slug: 'alpha', text: alphaDocument(), expectedBlob: null }],
    message: 'open_thread alpha: opened'
  })
  assert.ok(seeded.ok, 'the stored document must be seeded')
}

const withServer = async (fixture: Fixture, fn: (spawned: SpawnedServer) => Promise<void>): Promise<void> => {
  const spawned = await spawnServer({
    projectRoot: fixture.repo,
    entry: ENTRY,
    env: { CLAUDE_CODE_SESSION_ID: SESSION, HOME: fixture.home }
  })
  try {
    await fn(spawned)
  } finally {
    await spawned.close()
  }
}

const holdFile = (fixture: Fixture): string => join(fixture.paths.commonDir, 'logbook', 'holds', 'alpha.json')

const readHoldJson = (fixture: Fixture): HoldJson => {
  const parsed: unknown = JSON.parse(readFileSync(holdFile(fixture), 'utf8'))
  assert.ok(isRecord(parsed), 'the hold alpha.json must hold an object')
  return parsed
}

const writeHoldJson = (fixture: Fixture, hold: HoldJson): void => {
  const file = holdFile(fixture)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(hold))
}

const exitedProcess = (fixture: Fixture): number => {
  const child = spawnSync(process.execPath, ['-e', ''], { env: { HOME: fixture.home } })
  assert.equal(child.status, 0, 'the short-lived child process must exit cleanly')
  assert.equal(typeof child.pid, 'number', 'the short-lived child process must have a process id')
  return child.pid as number
}

const callTool = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
  const reply = (await spawned.client.callTool({ name, arguments: args })) as CallToolResult
  assert.equal(reply.isError, undefined, `expected ${name} to succeed, got: ${JSON.stringify(reply)}`)
  return reply
}

const assertHeldByThisProcess = (hold: HoldJson, after: string): void => {
  assert.equal(hold.holder, SESSION, `after ${after}, alpha.json must be held by ${SESSION}, got ${JSON.stringify(hold)}`)
  assert.equal(
    hold.process,
    process.pid,
    `after ${after}, alpha.json must record the server's parent process ${process.pid}, got ${JSON.stringify(hold)}`
  )
}

test('open_thread and resume_thread record the server parent process in the hold', async () => {
  await withFixture(async (fixture) => {
    await withServer(fixture, async (spawned) => {
      await callTool(spawned, 'open_thread', {
        slug: 'alpha',
        title: 'Work on alpha',
        goal: 'The alpha work is finished.',
        next_step: 'Start the alpha work.'
      })
      assertHeldByThisProcess(readHoldJson(fixture), 'open_thread')
      writeHoldJson(fixture, { ...readHoldJson(fixture), holder: 'someone-else', process: exitedProcess(fixture) })
      await callTool(spawned, 'resume_thread', { thread_id: 'alpha' })
      assertHeldByThisProcess(readHoldJson(fixture), 'resume_thread')
    })
  })
})

test('a starting server records its parent process in the hold its session holds', async () => {
  await withFixture(async (fixture) => {
    seedAlpha(fixture)
    writeHoldJson(fixture, {
      slug: 'alpha',
      holder: SESSION,
      transcripts: [],
      folded_at: null,
      nudged_prompt_id: null,
      process: exitedProcess(fixture),
      released_from: null
    })
    await withServer(fixture, async (spawned) => {
      await callTool(spawned, 'list_threads', {})
      assertHeldByThisProcess(readHoldJson(fixture), 'the server started')
    })
  })
})
