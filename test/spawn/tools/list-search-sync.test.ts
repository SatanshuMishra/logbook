import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { checkStructure } from '../../../src/doc/check.ts'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments, readDocument } from '../../../src/thread/store.ts'
import { rawGit, withRepo } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const SESSION = 'list-search-sync-session'
const SESSION_A = 'sync-clone-a-session'
const SESSION_B = 'sync-clone-b-session'
const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const TWO_CLONES_TIMEOUT_MS = 120000

const ALPHA_ROSTER_LINE = 'alpha - active - Next: Write the alpha handler.'
const BETA_ROSTER_LINE = 'beta - done - Next: Nothing is left to do.'
const CLOSED_LINE = '1 closed threads: call list_threads with include_closed true.'
const POSTGRES_LINE = '- D1 Use Postgres: the team already runs it'

const RECEIVE_PACK_SCRIPT = [
  '#!/bin/sh',
  'log="$1"',
  'shift',
  'git receive-pack "$@"',
  'status=$?',
  'echo pushed >> "$log"',
  'exit $status',
  ''
].join('\n')

type Seeded = { slug: string; text: string }

type Clone = { repo: string; log: string; spawned: SpawnedServer }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const threadDocument = (input: {
  slug: string
  title: string
  status: string
  nextIds: string
  nextStep: string
  decisions: string[]
}): string => {
  const lines = [
    `# ${input.slug}: ${input.title}`,
    `Status: ${input.status}`,
    `Updated: ${STORED_AT}`,
    input.nextIds,
    '',
    '## Goal',
    '',
    `The ${input.slug} feature works for every user.`,
    '',
    '## Done when',
    '',
    `- [ ] c1 The ${input.slug} page loads`,
    '',
    '## Where things stand',
    '',
    'The page renders but the handler is missing.',
    '',
    '## Next step',
    '',
    input.nextStep,
    '',
    '## Decisions in force',
    '',
    ...input.decisions,
    ...(input.decisions.length === 0 ? [] : ['']),
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    `- Spec: docs/specs/${input.slug}.md`
  ]
  return `${lines.join('\n')}\n`
}

const alphaDocument = (decisions: string[]): string =>
  threadDocument({
    slug: 'alpha',
    title: 'Build the alpha feature',
    status: 'active',
    nextIds: decisions.length === 0 ? 'Next ids: c2 D1 R1 S1' : 'Next ids: c2 D2 R1 S1',
    nextStep: 'Write the alpha handler.',
    decisions
  })

const betaDocument = (): string =>
  threadDocument({
    slug: 'beta',
    title: 'Build the beta feature',
    status: 'done',
    nextIds: 'Next ids: c2 D1 R1 S1',
    nextStep: 'Nothing is left to do.',
    decisions: []
  })

const makeRepo = (parent: string, name: string): string => {
  const repo = join(parent, name)
  mustGit(parent, ['init', '--quiet', '--initial-branch=main', repo])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '--quiet', '-m', 'fixture: initial commit'])
  return repo
}

const runtimeFor = (repo: string, home: string): Runtime =>
  testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: SESSION, start: STORED_AT })

const seedThreads = (repo: string, threads: readonly Seeded[]): void => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-list-search-sync-home-'))
  try {
    const rt = runtimeFor(repo, home)
    const found = findRepository(rt, repo)
    assert.ok(found.ok, `the test repository ${repo} must be found`)
    const seeded = commitDocuments(rt, found.value, {
      changes: threads.map((thread) => ({ slug: thread.slug, text: thread.text, expectedBlob: null })),
      message: 'seed the threads'
    })
    assert.ok(seeded.ok, 'the stored documents must be seeded')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const storedText = (repo: string, slug: string): string => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-list-search-sync-home-'))
  try {
    const rt = runtimeFor(repo, home)
    const found = findRepository(rt, repo)
    assert.ok(found.ok, `the repository ${repo} must be found`)
    const stored = readDocument(rt, found.value, slug)
    assert.ok(stored !== null, `${repo} must store a document for ${slug}`)
    return stored.text
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const withServer = async (
  threads: readonly Seeded[],
  fn: (spawned: SpawnedServer, repo: string) => Promise<void>
): Promise<void> => {
  const parent = mkdtempSync(join(tmpdir(), 'logbook-list-search-sync-'))
  try {
    const repo = makeRepo(parent, 'repo')
    if (threads.length > 0) seedThreads(repo, threads)
    const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_CODE_SESSION_ID: SESSION } })
    try {
      await fn(spawned, repo)
    } finally {
      await spawned.close()
    }
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

const callTool = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await spawned.client.callTool({ name, arguments: args })) as CallToolResult

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

const structuredOf = (reply: CallToolResult): Record<string, unknown> => {
  assertSucceeded(reply)
  assert.ok(reply.structuredContent !== undefined, 'the reply must carry structured content')
  return reply.structuredContent
}

const threadIdsOf = (reply: CallToolResult): unknown[] => {
  const threads = structuredOf(reply).threads
  assert.ok(Array.isArray(threads), 'structured threads must be a list')
  return threads.map((thread: { thread_id?: unknown }) => thread.thread_id)
}

const pushCount = (log: string): number => readFileSync(log, 'utf8').split('\n').filter((line) => line !== '').length

const pushesReach = (log: string, count: number): Promise<void> =>
  new Promise((resolve) => {
    let settled = false
    const watcher = watch(log)
    const check = (): void => {
      if (settled || pushCount(log) < count) return
      settled = true
      watcher.close()
      resolve()
    }
    watcher.on('change', check)
    check()
  })

const callThenAwaitPush = async (clone: Clone, name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
  const before = pushCount(clone.log)
  const reply = await callTool(clone.spawned, name, args)
  assertSucceeded(reply)
  await pushesReach(clone.log, before + 1)
  return reply
}

const makeClone = (base: string, origin: string, name: string, script: string): Omit<Clone, 'spawned'> => {
  const repo = join(base, name)
  const log = join(base, `pushes-${name}.log`)
  mustGit(base, ['clone', '--quiet', origin, repo])
  mustGit(repo, ['config', 'user.name', `Clone ${name}`])
  mustGit(repo, ['config', 'user.email', `${name}@logbook.test`])
  mustGit(repo, ['config', 'remote.origin.receivepack', `'${script}' '${log}'`])
  writeFileSync(log, '')
  return { repo, log }
}

const conflictsOf = (reply: CallToolResult): unknown => structuredOf(reply).conflicts

test('list_threads.spawn.contract', async () => {
  await import('../../../src/server/tools/list_threads.ts')
  const threads = [
    { slug: 'alpha', text: alphaDocument([]) },
    { slug: 'beta', text: betaDocument() }
  ]
  await withServer(threads, async (spawned) => {
    const reply = await callTool(spawned, 'list_threads', {})
    assertSucceeded(reply)
    assert.equal(textOf(reply), `${ALPHA_ROSTER_LINE}\n${CLOSED_LINE}`)
    const structured = structuredOf(reply)
    assert.equal(structured.closed_count, 1)
    const listed = structured.threads
    assert.ok(Array.isArray(listed) && listed.length === 1, `one thread must be listed, got ${JSON.stringify(listed)}`)
    const alpha = listed[0] as Record<string, unknown>
    assert.equal(alpha.thread_id, 'alpha')
    assert.equal(alpha.title, 'Build the alpha feature')
    assert.equal(alpha.status, 'active')
    assert.equal(alpha.next_step, 'Write the alpha handler.')
    assert.match(String(alpha.path), /\/\.logbook\/[^/]+\/alpha\.md$/)
  })
})

test('list_threads.includes-closed-threads', async () => {
  await import('../../../src/server/tools/list_threads.ts')
  const threads = [
    { slug: 'alpha', text: alphaDocument([]) },
    { slug: 'beta', text: betaDocument() }
  ]
  await withServer(threads, async (spawned) => {
    const reply = await callTool(spawned, 'list_threads', { include_closed: true })
    assert.deepEqual(threadIdsOf(reply), ['alpha', 'beta'])
    assert.equal(structuredOf(reply).closed_count, 1)
    assert.equal(textOf(reply), `${ALPHA_ROSTER_LINE}\n${BETA_ROSTER_LINE}`)
  })
})

test('list_threads.rejects-invalid', async () => {
  await import('../../../src/server/tools/list_threads.ts')
  await withServer([{ slug: 'alpha', text: alphaDocument([]) }], async (spawned) => {
    const reply = await callTool(spawned, 'list_threads', { limit: 10 })
    assert.equal(refusedField(reply), 'limit')
  })
})

test('search_ledger.spawn.contract', async () => {
  await import('../../../src/server/tools/search_ledger.ts')
  const threads = [
    { slug: 'alpha', text: alphaDocument([POSTGRES_LINE]) },
    { slug: 'beta', text: betaDocument() }
  ]
  await withServer(threads, async (spawned, repo) => {
    const commit = mustGit(repo, ['rev-parse', THREADS_REF]).trim()
    const date = mustGit(repo, ['log', '-1', '--format=%cI', THREADS_REF]).trim()
    const reply = await callTool(spawned, 'search_ledger', { text: 'postgres' })
    assertSucceeded(reply)
    assert.equal(textOf(reply), `${commit.slice(0, 8)} ${date} alpha.md: ${POSTGRES_LINE}`)
    assert.deepEqual(structuredOf(reply).matches, [{ commit, date, file: 'alpha.md', lines: [POSTGRES_LINE] }])
  })
})

test('search_ledger.rejects-invalid', async () => {
  await import('../../../src/server/tools/search_ledger.ts')
  await withServer([{ slug: 'alpha', text: alphaDocument([POSTGRES_LINE]) }], async (spawned) => {
    const blank = await callTool(spawned, 'search_ledger', { text: '  ' })
    assert.equal(refusedField(blank), 'text')
    const extra = await callTool(spawned, 'search_ledger', { text: 'postgres', regex: true })
    assert.equal(refusedField(extra), 'regex')
  })
})

test('sync_ledger.spawn.contract', async () => {
  await import('../../../src/server/tools/sync_ledger.ts')
  await withServer([{ slug: 'alpha', text: alphaDocument([]) }], async (spawned) => {
    const reply = await callTool(spawned, 'sync_ledger', {})
    assert.deepEqual(structuredOf(reply), {
      fetched: false,
      merged: false,
      conflicts: [],
      pushed: false,
      error: 'no-origin'
    })
  })
})

test('sync_ledger.rejects-invalid', async () => {
  await import('../../../src/server/tools/sync_ledger.ts')
  await withServer([], async (spawned) => {
    const reply = await callTool(spawned, 'sync_ledger', { remote: 'origin' })
    assert.equal(refusedField(reply), 'remote')
  })
})

test('sync_ledger.two-clones-edit-one-thread-and-merge', { timeout: TWO_CLONES_TIMEOUT_MS }, async () => {
  await import('../../../src/server/tools/sync_ledger.ts')
  const base = mkdtempSync(join(tmpdir(), 'logbook-two-clones-'))
  const opened: SpawnedServer[] = []
  try {
    const origin = join(base, 'origin.git')
    mustGit(base, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
    withRepo((seed) => mustGit(seed, ['push', '--quiet', origin, 'main']))
    const script = join(base, 'receive-pack.sh')
    writeFileSync(script, RECEIVE_PACK_SCRIPT, { mode: 0o755 })
    const madeA = makeClone(base, origin, 'a', script)
    const madeB = makeClone(base, origin, 'b', script)
    const spawnedA = await spawnServer({ projectRoot: madeA.repo, entry: ENTRY, env: { CLAUDE_CODE_SESSION_ID: SESSION_A } })
    opened.push(spawnedA)
    const spawnedB = await spawnServer({ projectRoot: madeB.repo, entry: ENTRY, env: { CLAUDE_CODE_SESSION_ID: SESSION_B } })
    opened.push(spawnedB)
    const a: Clone = { ...madeA, spawned: spawnedA }
    const b: Clone = { ...madeB, spawned: spawnedB }

    await callThenAwaitPush(a, 'open_thread', {
      slug: 'fix-login',
      title: 'Fix the login page',
      goal: 'Users can log in again.',
      next_step: 'Fix the submit handler.',
      criteria: ['The login page loads', 'Submitting the form logs the user in']
    })
    const firstSyncA = await callTool(a.spawned, 'sync_ledger', {})
    const firstSyncB = await callTool(b.spawned, 'sync_ledger', {})
    assertSucceeded(await callTool(b.spawned, 'resume_thread', { thread_id: 'fix-login' }))
    await callThenAwaitPush(a, 'update_thread', {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c1', result: 'the login page loaded in the first run' }]
    })
    await callThenAwaitPush(b, 'update_thread', {
      thread_id: 'fix-login',
      risks_add: [{ text: 'The staging database may be stale' }]
    })
    const secondSyncA = await callTool(a.spawned, 'sync_ledger', {})
    const secondSyncB = await callTool(b.spawned, 'sync_ledger', {})
    const thirdSyncA = await callTool(a.spawned, 'sync_ledger', {})

    for (const reply of [firstSyncA, firstSyncB, secondSyncA, secondSyncB, thirdSyncA]) {
      assert.deepEqual(conflictsOf(reply), [], `no sync may report a conflict, got: ${JSON.stringify(reply)}`)
      assert.equal(structuredOf(reply).error, null, `no sync may fail, got: ${JSON.stringify(reply)}`)
    }

    const storedA = storedText(a.repo, 'fix-login')
    const storedB = storedText(b.repo, 'fix-login')
    assert.equal(storedA, storedB)
    const lines = storedA.split('\n')
    assert.ok(
      lines.includes('- [x] c1 The login page loads evidence: the login page loaded in the first run'),
      `the merged document must hold the tick, got:\n${storedA}`
    )
    assert.ok(
      lines.includes('- R1 The staging database may be stale'),
      `the merged document must hold the risk, got:\n${storedA}`
    )
    assert.deepEqual(checkStructure(storedA, 'fix-login'), [])
  } finally {
    for (const spawned of opened) await spawned.close()
    rmSync(base, { recursive: true, force: true })
  }
})
