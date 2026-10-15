import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ulid } from 'ulid'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { readHold, takeHold, writeRedirect } from '../../../src/thread/holds.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const OPEN_C1 = '- [ ] c1 The login page loads'
const TICKED_C1 = '- [x] c1 The login page loads evidence: the login test passed'
const OPEN_C2 = '- [ ] c2 The session survives a reload'
const STRUCK_C2 = '- [~] c2 The session survives a reload struck: the owner moved it to another thread'

type Seed = { status: string; criteria: string[]; aliases?: Record<string, string> }

type Setup = (rt: Runtime, paths: RepoPaths) => void

type Fixture = { repo: string; paths: RepoPaths; spawned: SpawnedServer }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const fixLogin = (status: string, criteria: readonly string[]): string => {
  const lines = [
    '# fix-login: Fix the login page',
    `Status: ${status}`,
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
  const repo = mkdtempSync(join(tmpdir(), 'logbook-park-close-repo-'))
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const seedThread = (repo: string, home: string, seed: Seed, setup: Setup): RepoPaths => {
  const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 'seed', start: STORED_AT })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the test repository must be found')
  const seeded = commitDocuments(rt, found.value, {
    changes: [{ slug: 'fix-login', text: fixLogin(seed.status, seed.criteria), expectedBlob: null }],
    message: 'open_thread fix-login: opened',
    ...(seed.aliases === undefined ? {} : { aliases: seed.aliases })
  })
  assert.ok(seeded.ok, 'the stored document must be seeded')
  setup(rt, found.value)
  return found.value
}

const withThread = async (
  seed: Seed,
  session: string,
  setup: Setup,
  fn: (fixture: Fixture) => Promise<void>
): Promise<void> => {
  const repo = makeRepo()
  const home = mkdtempSync(join(tmpdir(), 'logbook-park-close-home-'))
  try {
    const paths = seedThread(repo, home, seed, setup)
    const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_CODE_SESSION_ID: session } })
    try {
      await fn({ repo, paths, spawned })
    } finally {
      await spawned.close()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
}

const noSetup: Setup = () => {}

const heldBy =
  (session: string): Setup =>
  (rt, paths) => {
    takeHold(rt, paths, 'fix-login', session, null)
  }

const callTool = async (fixture: Fixture, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fixture.spawned.client.callTool({ name, arguments: args })) as CallToolResult

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
  assert.ok(
    (lines[index + 1] ?? '').startsWith('accepted: '),
    `the field line must be followed by an "accepted: " line, got:\n${textOf(reply)}`
  )
  return (lines[index] ?? '').slice('field: '.length)
}

const assertSucceeded = (reply: CallToolResult): void => {
  assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS_REF]).trim()

const storedLines = (repo: string): string[] => mustGit(repo, ['cat-file', 'blob', `${THREADS_REF}:fix-login.md`]).split('\n')

const statusLine = (repo: string): string | undefined => storedLines(repo).find((line) => line.startsWith('Status:'))

const messageLines = (repo: string): string[] =>
  mustGit(repo, ['log', '-1', '--format=%B', THREADS_REF]).replace(/\n+$/, '').split('\n')

const holderOf = (paths: RepoPaths): string | null => {
  const hold = readHold(paths, 'fix-login')
  assert.ok(hold !== null, 'the thread must still have a hold file')
  return hold.holder
}

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

test('park_thread.spawn.contract', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  await withThread({ status: 'active', criteria: [OPEN_C1, OPEN_C2] }, 's1', heldBy('s1'), async (fixture) => {
    assert.equal(holderOf(fixture.paths), 's1')
    const reply = await callTool(fixture, 'park_thread', {
      next_step: 'Run the build.',
      outcome: 'The submit handler now posts the form.'
    })

    assertSucceeded(reply)
    const [first, second] = textOf(reply).split('\n')
    assert.ok(textOf(reply).startsWith('parked thread fix-login'), `unexpected reply text: ${textOf(reply)}`)
    assert.equal(first, 'parked thread fix-login')
    assert.ok(second !== undefined && second.endsWith('/fix-login.md'), `the next line must be the working copy path, got: ${second}`)
    assert.equal(statusLine(fixture.repo), 'Status: parked')
    assert.deepEqual(nextStepBody(storedLines(fixture.repo)), ['Run the build.'])
    const message = messageLines(fixture.repo)
    assert.equal(message[0], 'park_thread fix-login: parked')
    assert.ok(message.includes('The submit handler now posts the form.'), `the commit must hold the outcome, got:\n${message.join('\n')}`)
    assert.equal(holderOf(fixture.paths), null)
    assert.deepEqual(reply.structuredContent, { parked_thread_ids: ['fix-login'] })
  })
})

test('park_thread.rejects-invalid', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  await withThread({ status: 'active', criteria: [OPEN_C1, OPEN_C2] }, 's1', noSetup, async (fixture) => {
    const before = tipOf(fixture.repo)

    assert.equal(refusedField(await callTool(fixture, 'park_thread', {})), 'thread_id')
    assert.equal(refusedField(await callTool(fixture, 'park_thread', { thread_id: 'fix-login', session: 's1' })), 'session')
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
    assert.equal(statusLine(fixture.repo), 'Status: active')
  })
})

test('park_thread.parks-a-named-thread-with-no-fields', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  await withThread({ status: 'active', criteria: [OPEN_C1, OPEN_C2] }, 's1', noSetup, async (fixture) => {
    const reply = await callTool(fixture, 'park_thread', { thread_id: 'fix-login' })

    assertSucceeded(reply)
    assert.equal(statusLine(fixture.repo), 'Status: parked')
    assert.deepEqual(nextStepBody(storedLines(fixture.repo)), ['Fix the submit handler.'])
    assert.equal(messageLines(fixture.repo).join('\n'), 'park_thread fix-login: parked')
  })
})

test('park_thread.names-old-ids', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  const oldId = ulid()
  const seed: Seed = { status: 'active', criteria: [OPEN_C1, OPEN_C2], aliases: { [oldId]: 'fix-login' } }
  await withThread(seed, 's1', noSetup, async (fixture) => {
    const reply = await callTool(fixture, 'park_thread', { thread_id: oldId })

    assertSucceeded(reply)
    assert.deepEqual(reply.structuredContent, { parked_thread_ids: ['fix-login', oldId] })
    assert.equal(statusLine(fixture.repo), 'Status: parked')
  })
})

test('park_thread.after-a-clear-parks-the-new-sessions-thread', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  const redirected: Setup = (rt, paths) => {
    writeRedirect(rt, paths, 's1', 's2')
    takeHold(rt, paths, 'fix-login', 's2', null)
  }
  await withThread({ status: 'active', criteria: [OPEN_C1, OPEN_C2] }, 's1', redirected, async (fixture) => {
    const reply = await callTool(fixture, 'park_thread', {})

    assertSucceeded(reply)
    assert.ok(textOf(reply).startsWith('parked thread fix-login'), `unexpected reply text: ${textOf(reply)}`)
    assert.equal(statusLine(fixture.repo), 'Status: parked')
    assert.equal(holderOf(fixture.paths), null)
  })
})

test('park_thread.refuses-a-closed-thread', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  await withThread({ status: 'done', criteria: [TICKED_C1, STRUCK_C2] }, 's1', noSetup, async (fixture) => {
    const before = tipOf(fixture.repo)
    const reply = await callTool(fixture, 'park_thread', { thread_id: 'fix-login' })

    assert.equal(refusedField(reply), 'thread_id')
    assert.ok(textOf(reply).includes('is closed'), `the refusal must say the thread is closed, got:\n${textOf(reply)}`)
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
    assert.equal(statusLine(fixture.repo), 'Status: done')
  })
})

test('close_thread.spawn.contract', async () => {
  await import('../../../src/server/tools/close_thread.ts')
  await withThread({ status: 'active', criteria: [TICKED_C1, STRUCK_C2] }, 's1', heldBy('s1'), async (fixture) => {
    assert.equal(holderOf(fixture.paths), 's1')
    const reply = await callTool(fixture, 'close_thread', {
      thread_id: 'fix-login',
      outcome: 'done',
      detail: 'The login page works again.'
    })

    assertSucceeded(reply)
    assert.equal(textOf(reply), 'closed thread fix-login as done')
    assert.deepEqual(reply.structuredContent, { thread_id: 'fix-login', status: 'done' })
    assert.equal(statusLine(fixture.repo), 'Status: done')
    const message = messageLines(fixture.repo)
    assert.equal(message[0], 'close_thread fix-login: done')
    assert.ok(message.includes('The login page works again.'), `the commit must hold the detail, got:\n${message.join('\n')}`)
    assert.equal(holderOf(fixture.paths), null)
  })
})

test('close_thread.rejects-invalid', async () => {
  await import('../../../src/server/tools/close_thread.ts')
  await withThread({ status: 'active', criteria: [TICKED_C1, STRUCK_C2] }, 's1', noSetup, async (fixture) => {
    const before = tipOf(fixture.repo)
    const calls: [string, Record<string, unknown>][] = [
      ['outcome', { thread_id: 'fix-login', outcome: 'finished', detail: 'The login page works again.' }],
      ['detail', { thread_id: 'fix-login', outcome: 'done', detail: '  ' }],
      ['force', { thread_id: 'fix-login', outcome: 'done', detail: 'The login page works again.', force: true }]
    ]

    for (const [field, args] of calls) {
      assert.equal(refusedField(await callTool(fixture, 'close_thread', args)), field)
    }
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
    assert.equal(statusLine(fixture.repo), 'Status: active')
  })
})

test('close_thread.refuses-done-with-an-open-criterion', async () => {
  await import('../../../src/server/tools/close_thread.ts')
  await withThread({ status: 'active', criteria: [TICKED_C1, OPEN_C2] }, 's1', noSetup, async (fixture) => {
    const before = tipOf(fixture.repo)
    const reply = await callTool(fixture, 'close_thread', {
      thread_id: 'fix-login',
      outcome: 'done',
      detail: 'The login page works again.'
    })

    refusedField(reply)
    assert.match(textOf(reply), /\bc2\b/, `the refusal must name c2, got:\n${textOf(reply)}`)
    assert.equal(tipOf(fixture.repo), before, 'a refused close must commit nothing')
    assert.equal(statusLine(fixture.repo), 'Status: active')
  })
})

test('close_thread.abandons-with-open-criteria', async () => {
  await import('../../../src/server/tools/close_thread.ts')
  await withThread({ status: 'active', criteria: [TICKED_C1, OPEN_C2] }, 's1', noSetup, async (fixture) => {
    const reply = await callTool(fixture, 'close_thread', {
      thread_id: 'fix-login',
      outcome: 'abandoned',
      detail: 'the owner dropped it'
    })

    assertSucceeded(reply)
    assert.equal(textOf(reply), 'closed thread fix-login as abandoned')
    assert.deepEqual(reply.structuredContent, { thread_id: 'fix-login', status: 'abandoned: the owner dropped it' })
    assert.equal(statusLine(fixture.repo), 'Status: abandoned: the owner dropped it')
    assert.equal(messageLines(fixture.repo)[0], 'close_thread fix-login: abandoned')
  })
})

test('close_thread.refuses-a-closed-thread', async () => {
  await import('../../../src/server/tools/close_thread.ts')
  await withThread({ status: 'done', criteria: [TICKED_C1, STRUCK_C2] }, 's1', noSetup, async (fixture) => {
    const before = tipOf(fixture.repo)
    const reply = await callTool(fixture, 'close_thread', {
      thread_id: 'fix-login',
      outcome: 'done',
      detail: 'The login page works again.'
    })

    assert.equal(refusedField(reply), 'thread_id')
    assert.ok(textOf(reply).includes('is closed'), `the refusal must say the thread is closed, got:\n${textOf(reply)}`)
    assert.equal(tipOf(fixture.repo), before, 'a refused call must commit nothing')
  })
})
