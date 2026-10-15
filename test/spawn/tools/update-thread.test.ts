import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ulid } from 'ulid'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const SESSION = 'update-thread-session'
const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const OPEN_C1 = '- [ ] c1 The login page loads'
const TICKED_C1 = '- [x] c1 The login page loads evidence: the first run passed'

type Fixture = { repo: string; spawned: SpawnedServer }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const fixLogin = (criterion: string): string => {
  const lines = [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D2 R2 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    criterion,
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
    '- Spec: docs/specs/login.md'
  ]
  return `${lines.join('\n')}\n`
}

const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-update-thread-repo-'))
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const seedThread = (repo: string, text: string): void => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-update-thread-home-'))
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

const updateThread = async (fixture: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fixture.spawned.client.callTool({ name: 'update_thread', arguments: args })) as CallToolResult

const textOf = (reply: CallToolResult): string => {
  const first = reply.content[0]
  assert.ok(first !== undefined && first.type === 'text', 'the reply must carry a text content block')
  return first.text
}

const refusalLines = (reply: CallToolResult): { field: string; accepted: string } => {
  assert.equal(reply.isError, true, `expected a refusal, got: ${JSON.stringify(reply)}`)
  const lines = textOf(reply).split('\n')
  const index = lines.findIndex((line) => line.startsWith('field: '))
  assert.ok(index >= 0, `the refusal must have a "field: " line, got:\n${textOf(reply)}`)
  const accepted = lines[index + 1] ?? ''
  assert.ok(accepted.startsWith('accepted: '), `the field line must be followed by an "accepted: " line, got:\n${textOf(reply)}`)
  return { field: (lines[index] ?? '').slice('field: '.length), accepted: accepted.slice('accepted: '.length) }
}

const refusedField = (reply: CallToolResult): string => refusalLines(reply).field

const assertSucceeded = (reply: CallToolResult): void => {
  assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS_REF]).trim()

const storedLines = (repo: string): string[] => mustGit(repo, ['cat-file', 'blob', `${THREADS_REF}:fix-login.md`]).split('\n')

const messageLines = (repo: string): string[] =>
  mustGit(repo, ['log', '-1', '--format=%B', THREADS_REF]).replace(/\n+$/, '').split('\n')

const nextStepBody = (lines: readonly string[]): string[] => {
  const start = lines.indexOf('## Next step')
  assert.ok(start >= 0, 'the stored document must have a "## Next step" section')
  const after = lines.slice(start + 1)
  const end = after.findIndex((line) => line.startsWith('## '))
  const body = end < 0 ? after : after.slice(0, end)
  const first = body.findIndex((line) => line.trim() !== '')
  const last = body.reduce((found, line, index) => (line.trim() === '' ? found : index), -1)
  return first < 0 ? [] : body.slice(first, last + 1)
}

test('update_thread.spawn.contract', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const reply = await updateThread(fixture, {
      thread_id: 'fix-login',
      next_step: 'Run the build.',
      next_step_records: ['D1', 'R1']
    })

    assertSucceeded(reply)
    assert.ok(textOf(reply).startsWith('updated thread fix-login:'), `unexpected reply text: ${textOf(reply)}`)
    assert.deepEqual(reply.structuredContent, { thread_id: 'fix-login', summary: 'next step set', added_risk_ids: [] })
    assert.deepEqual(nextStepBody(storedLines(fixture.repo)), ['Run the build.', '', 'Needs: D1, R1.'])
    assert.equal(messageLines(fixture.repo)[0], 'update_thread fix-login: next step set')
  })
})

test('update_thread.next-step-alone', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const reply = await updateThread(fixture, { thread_id: 'fix-login', next_step: 'Run the build.' })

    assertSucceeded(reply)
    assert.deepEqual(nextStepBody(storedLines(fixture.repo)), ['Run the build.'])
    assert.ok(!storedLines(fixture.repo).some((line) => line.startsWith('Needs:')), 'no Needs line may be written')
  })
})

test('update_thread.rejects-invalid', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const before = tipOf(fixture.repo)
    const calls: [string, Record<string, unknown>][] = [
      ['next_step_records', { thread_id: 'fix-login', next_step_records: ['D1'] }],
      ['(root)', { thread_id: 'fix-login' }],
      ['blocked_by', { thread_id: 'fix-login', next_step: 'Run the build.', blocked_by: 'the vendor' }]
    ]

    for (const [field, args] of calls) {
      const reply = await updateThread(fixture, args)
      assert.equal(refusedField(reply), field)
    }
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})

test('update_thread.refuses-unknown-record-ids', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const before = tipOf(fixture.repo)

    const refusal = refusalLines(
      await updateThread(fixture, { thread_id: 'fix-login', next_step: 'Run the build.', next_step_records: [ulid(), 'D9'] })
    )

    assert.equal(refusal.field, 'next_step_records')
    assert.ok(refusal.accepted.includes('ids of items in the document'), `unexpected accepted text: ${refusal.accepted}`)
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})

test('update_thread.ticks-a-criterion', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const reply = await updateThread(fixture, {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c1', result: 'login.loads passed' }]
    })

    assertSucceeded(reply)
    assert.ok(storedLines(fixture.repo).includes('- [x] c1 The login page loads evidence: login.loads passed'))
  })
})

test('update_thread.leaves-a-ticked-criterion', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(TICKED_C1), async (fixture) => {
    const reply = await updateThread(fixture, {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c1', result: 'login.loads passed' }]
    })

    assertSucceeded(reply)
    const stored = storedLines(fixture.repo)
    assert.ok(stored.includes(TICKED_C1), 'c1 must keep its line')
    assert.equal(stored.filter((line) => line.startsWith('- [x] c1 ')).length, 1)
  })
})

test('update_thread.refuses-an-unknown-criterion', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const before = tipOf(fixture.repo)

    const reply = await updateThread(fixture, {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c9', result: 'login.loads passed' }]
    })

    assert.equal(refusedField(reply), 'criteria_done.0.criterion_id')
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})

test('update_thread.adds-risks', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const reply = await updateThread(fixture, {
      thread_id: 'fix-login',
      risks_add: [{ text: 'Flaky CI', bears_on: 'c1' }, { text: 'Vendor delay' }]
    })

    assertSucceeded(reply)
    const stored = storedLines(fixture.repo)
    assert.ok(stored.includes('- R2 Flaky CI Bears on c1.'))
    assert.ok(stored.includes('- R3 Vendor delay'))
    assert.deepEqual((reply.structuredContent as { added_risk_ids: unknown }).added_risk_ids, ['R2', 'R3'])
  })
})

test('update_thread.refuses-a-risk-on-an-unknown-criterion', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const before = tipOf(fixture.repo)

    const reply = await updateThread(fixture, { thread_id: 'fix-login', risks_add: [{ text: 'x', bears_on: 'c9' }] })

    assert.equal(refusedField(reply), 'risks_add.0.bears_on')
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})

test('update_thread.retires-a-risk', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const reply = await updateThread(fixture, {
      thread_id: 'fix-login',
      risks_retire: [{ risk_id: 'R1', reason: 'the migration ran' }]
    })

    assertSucceeded(reply)
    assert.ok(!storedLines(fixture.repo).some((line) => line.startsWith('- R1 ')), 'R1 must be removed from the document')
    assert.ok(messageLines(fixture.repo).includes('Removed: R1 because the migration ran'))
  })
})

test('update_thread.refuses-an-unknown-risk', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withThread(fixLogin(OPEN_C1), async (fixture) => {
    const before = tipOf(fixture.repo)

    const reply = await updateThread(fixture, {
      thread_id: 'fix-login',
      risks_retire: [{ risk_id: 'R9', reason: 'the migration ran' }]
    })

    assert.equal(refusedField(reply), 'risks_retire.0.risk_id')
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})
