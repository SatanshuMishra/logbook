import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const SESSION = 'record-decision-session'
const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const D1_LINE = '- D1 Keep the session cookie: the mobile app reads it'

type Fixture = { repo: string; spawned: SpawnedServer }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const fixLogin = (decisions: readonly string[], nextIds: string): string => {
  const lines = [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    `Next ids: ${nextIds}`,
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
    'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    'Fix the submit handler.',
    '',
    '## Decisions in force',
    '',
    ...(decisions.length === 0 ? [] : [...decisions, '']),
    '## Open risks',
    '',
    '- R1 The staging database may be stale',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md'
  ]
  return `${lines.join('\n')}\n`
}

const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-record-decision-repo-'))
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const seedThread = (repo: string, text: string): void => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-record-decision-home-'))
  try {
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: SESSION, start: STORED_AT })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const withThread = async (text: string, fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = makeRepo()
  try {
    seedThread(repo, text)
    const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_CODE_SESSION_ID: SESSION } })
    try {
      await fn({ repo, spawned })
    } finally {
      await spawned.close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

const recordDecision = async (fixture: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fixture.spawned.client.callTool({ name: 'record_decision', arguments: args })) as CallToolResult

const textOf = (reply: CallToolResult): string => {
  const first = reply.content[0]
  assert.ok(first !== undefined && first.type === 'text', 'the reply must carry a text content block')
  return first.text
}

const refusedField = (reply: CallToolResult): string => {
  assert.equal(reply.isError, true, `expected a refusal, got: ${JSON.stringify(reply)}`)
  const lines = textOf(reply).split('\n')
  const index = lines.findIndex((line) => line.startsWith('field: '))
  assert.ok(index >= 0, `the refusal must have a "field: " line, got:\n${textOf(reply)}`)
  assert.ok(lines[index + 1]?.startsWith('accepted: '), `the field line must be followed by an "accepted: " line, got:\n${textOf(reply)}`)
  return (lines[index] ?? '').slice('field: '.length)
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS_REF]).trim()

const storedLines = (repo: string): string[] => mustGit(repo, ['cat-file', 'blob', `${THREADS_REF}:fix-login.md`]).split('\n')

const messageLines = (repo: string): string[] =>
  mustGit(repo, ['log', '-1', '--format=%B', THREADS_REF]).replace(/\n+$/, '').split('\n')

const validCall = {
  thread_id: 'fix-login',
  title: 'Store sessions in Postgres',
  context: 'Sessions are lost whenever the web server restarts.',
  options: ['Postgres', 'Redis'],
  option_reasons: ['it is already deployed', 'it needs a new server'],
  outcome: 'Postgres, because it is already deployed'
}

test('record_decision.spawn.contract', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withThread(fixLogin([], 'c2 D1 R2 S1'), async (fixture) => {
    const reply = await recordDecision(fixture, validCall)

    assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
    assert.equal(textOf(reply), 'recorded decision D1 on thread fix-login')
    assert.deepEqual(reply.structuredContent, { thread_id: 'fix-login', decision_id: 'D1', removed: [] })
    assert.ok(storedLines(fixture.repo).includes('- D1 Store sessions in Postgres: Postgres, because it is already deployed'))
    const message = messageLines(fixture.repo)
    assert.equal(message[0], 'record_decision fix-login: D1 Store sessions in Postgres')
    assert.ok(message.includes('Context: Sessions are lost whenever the web server restarts.'))
    assert.ok(message.includes('Option: Postgres - it is already deployed'))
    assert.ok(message.includes('Option: Redis - it needs a new server'))
    assert.ok(message.includes('Outcome: Postgres, because it is already deployed'))
  })
})

test('record_decision.without-reasons', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withThread(fixLogin([], 'c2 D1 R2 S1'), async (fixture) => {
    const reply = await recordDecision(fixture, {
      thread_id: 'fix-login',
      title: 'Store sessions in Postgres',
      context: 'Sessions are lost whenever the web server restarts.',
      options: ['Postgres', 'Redis'],
      outcome: 'Postgres, because it is already deployed'
    })

    assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
    assert.equal(textOf(reply), 'recorded decision D1 on thread fix-login')
    assert.ok(storedLines(fixture.repo).includes('- D1 Store sessions in Postgres: Postgres, because it is already deployed'))
    const optionLines = messageLines(fixture.repo).filter((line) => line.startsWith('Option: '))
    assert.deepEqual(optionLines, ['Option: Postgres', 'Option: Redis'])
  })
})

test('record_decision.rejects-invalid', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withThread(fixLogin([], 'c2 D1 R2 S1'), async (fixture) => {
    const before = tipOf(fixture.repo)
    const calls: [string, Record<string, unknown>][] = [
      ['options', { ...validCall, options: ['Postgres'], option_reasons: undefined }],
      ['option_reasons', { ...validCall, option_reasons: ['it is already deployed', 'it needs a new server', 'it is fast'] }],
      ['outcome', { ...validCall, outcome: '   ' }],
      ['commit', { ...validCall, commit: 'abc' }]
    ]

    for (const [field, args] of calls) {
      const reply = await recordDecision(fixture, args)
      assert.equal(refusedField(reply), field)
    }
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})

test('record_decision.rejects-blank-texts', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withThread(fixLogin([], 'c2 D1 R2 S1'), async (fixture) => {
    const before = tipOf(fixture.repo)
    const calls: [string, Record<string, unknown>][] = [
      ['title', { ...validCall, title: ' ' }],
      ['context', { ...validCall, context: '' }],
      ['options.1', { ...validCall, options: ['Postgres', '  '] }]
    ]

    for (const [field, args] of calls) {
      const reply = await recordDecision(fixture, args)
      assert.equal(refusedField(reply), field)
    }
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})

test('record_decision.supersedes-a-decision-in-force', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withThread(fixLogin([D1_LINE], 'c2 D2 R2 S1'), async (fixture) => {
    const reply = await recordDecision(fixture, { ...validCall, supersedes: ['D1'] })

    assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
    assert.equal(textOf(reply), 'recorded decision D2 on thread fix-login')
    assert.deepEqual(reply.structuredContent, { thread_id: 'fix-login', decision_id: 'D2', removed: ['D1'] })
    const stored = storedLines(fixture.repo)
    assert.ok(stored.includes('- D2 Store sessions in Postgres: Postgres, because it is already deployed'))
    assert.ok(!stored.some((line) => line.startsWith('- D1 ')), 'D1 must be removed from the document')
    assert.ok(messageLines(fixture.repo).includes('Removed: D1 because superseded by D2'))
  })
})

test('record_decision.refuses-an-unknown-superseded-id', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withThread(fixLogin([D1_LINE], 'c2 D2 R2 S1'), async (fixture) => {
    const before = tipOf(fixture.repo)

    assert.equal(refusedField(await recordDecision(fixture, { ...validCall, supersedes: ['D9'] })), 'supersedes.0')
    assert.equal(refusedField(await recordDecision(fixture, { ...validCall, supersedes: ['R1'] })), 'supersedes.0')
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
    assert.ok(storedLines(fixture.repo).includes(D1_LINE))
  })
})

test('record_decision.refuses-an-unknown-thread', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withThread(fixLogin([], 'c2 D1 R2 S1'), async (fixture) => {
    const before = tipOf(fixture.repo)

    const reply = await recordDecision(fixture, { ...validCall, thread_id: 'ghost' })

    assert.equal(refusedField(reply), 'thread_id')
    assert.ok(textOf(reply).split('\n').includes('accepted: the slug of a thread, or an old thread id listed in aliases.json'))
    assert.ok(textOf(reply).includes('list_threads'), 'the refusal must advise calling list_threads')
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})
