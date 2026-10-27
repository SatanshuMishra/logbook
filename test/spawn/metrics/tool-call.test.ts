import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const RUN_FILE = /^fix-login\.[0-9]{8}T[0-9]{6}Z\.jsonl$/

const OPEN_ARGS = {
  slug: 'fix-login',
  title: 'Fix the login page',
  goal: 'Users can log in again.',
  next_step: 'Fix the submit handler.'
}

type Line = Record<string, unknown>

type Fixture = { repo: string; home: string; spawned: SpawnedServer }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-metrics-repo-'))
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withServer = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = makeRepo()
  const home = mkdtempSync(join(tmpdir(), 'logbook-metrics-home-'))
  try {
    const spawned = await spawnServer({
      projectRoot: repo,
      entry: ENTRY,
      env: { HOME: home, CLAUDE_CODE_SESSION_ID: 's-1' }
    })
    try {
      await fn({ repo, home, spawned })
    } finally {
      await spawned.close()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
}

const callTool = async (fixture: Fixture, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fixture.spawned.client.callTool({ name, arguments: args })) as CallToolResult

const assertSucceeded = (reply: CallToolResult): void => {
  assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
}

const textOf = (reply: CallToolResult): string => {
  const first = reply.content[0]
  assert.ok(first !== undefined && first.type === 'text', 'the reply must carry a text content block')
  return first.text
}

const storeOf = (fixture: Fixture): string => join(fixture.home, '.plugin-metrics')

const eventFolder = (fixture: Fixture): string =>
  join(storeOf(fixture), 'plugin=logbook', 'kind=event', `repo=${basename(fixture.repo)}`)

const runLines = (fixture: Fixture): Line[] => {
  const folder = eventFolder(fixture)
  const files = existsSync(folder) ? readdirSync(folder) : []
  assert.equal(files.length, 1, `expected exactly one run file, got: ${JSON.stringify(files)}`)
  const [file = ''] = files
  assert.match(file, RUN_FILE)
  return readFileSync(join(folder, file), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Line)
}

const filesUnder = (folder: string): string[] =>
  existsSync(folder)
    ? readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? filesUnder(join(folder, entry.name)) : [join(folder, entry.name)]
      )
    : []

test('metrics.tool-call-ok', async () => {
  await import('../../../src/metrics/record.ts')
  await withServer(async (fixture) => {
    assertSucceeded(await callTool(fixture, 'open_thread', OPEN_ARGS))
    assertSucceeded(await callTool(fixture, 'update_thread', { thread_id: 'fix-login', next_step: 'Run the build.' }))
    const calls = runLines(fixture).filter((line) => line.event === 'tool.call')
    assert.deepEqual(
      calls.map((line) => line.tool),
      ['open_thread', 'update_thread']
    )
    for (const line of calls) {
      assert.equal(line.outcome, 'ok')
      assert.equal(line.refusal_field, null)
      assert.equal(typeof line.call_seconds, 'number')
      assert.ok((line.call_seconds as number) >= 0, `call_seconds must be at least 0, got ${String(line.call_seconds)}`)
    }
  })
})

test('metrics.tool-call-refused-names-field', async () => {
  await import('../../../src/metrics/record.ts')
  await withServer(async (fixture) => {
    assertSucceeded(await callTool(fixture, 'open_thread', { ...OPEN_ARGS, criteria: ['The login page loads'] }))
    const reply = await callTool(fixture, 'update_thread', {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c9', result: 'the login test passed' }]
    })
    assert.equal(reply.isError, true, `expected a refusal, got: ${JSON.stringify(reply)}`)
    const firstLine = textOf(reply).split('\n')[0] ?? ''
    assert.ok(firstLine.startsWith('field: '), `the reply must open with a "field: " line, got: ${firstLine}`)
    const last = runLines(fixture).filter((line) => line.event === 'tool.call').at(-1)
    assert.equal(last?.tool, 'update_thread')
    assert.equal(last?.outcome, 'refused')
    assert.equal(last?.refusal_field, firstLine.slice('field: '.length))
  })
})

test('metrics.held-thread-takes-unnamed-calls', async () => {
  await import('../../../src/metrics/record.ts')
  await withServer(async (fixture) => {
    assertSucceeded(await callTool(fixture, 'open_thread', OPEN_ARGS))
    assertSucceeded(await callTool(fixture, 'list_threads', {}))
    assertSucceeded(await callTool(fixture, 'park_thread', {}))
    const calls = runLines(fixture).filter((line) => line.event === 'tool.call')
    assert.deepEqual(
      calls.map((line) => [line.tool, line.outcome]),
      [
        ['open_thread', 'ok'],
        ['list_threads', 'ok'],
        ['park_thread', 'ok']
      ]
    )
  })
})

test('metrics.unknown-thread-refusal-goes-to-held', async () => {
  await import('../../../src/metrics/record.ts')
  await withServer(async (fixture) => {
    assertSucceeded(await callTool(fixture, 'open_thread', OPEN_ARGS))
    const reply = await callTool(fixture, 'resume_thread', { thread_id: 'no-such-thread' })
    assert.equal(reply.isError, true, `expected a refusal, got: ${JSON.stringify(reply)}`)
    const last = runLines(fixture).at(-1)
    assert.equal(last?.event, 'tool.call')
    assert.equal(last?.tool, 'resume_thread')
    assert.equal(last?.outcome, 'refused')
    assert.equal(last?.refusal_field, 'thread_id')
  })
})

test('metrics.call-with-no-thread-not-recorded', async () => {
  await import('../../../src/metrics/record.ts')
  await withServer(async (fixture) => {
    assertSucceeded(await callTool(fixture, 'list_threads', {}))
    assert.deepEqual(filesUnder(join(storeOf(fixture), 'plugin=logbook', 'kind=event')), [])
  })
})

const THREADS_REF = 'refs/logbook/threads'

const toolCallsByThread = (home: string, repo: string): Record<string, string[]> => {
  const folder = join(home, '.plugin-metrics', 'plugin=logbook', 'kind=event', `repo=${basename(repo)}`)
  const files = existsSync(folder) ? readdirSync(folder) : []
  return Object.fromEntries(
    files.map((file) => [
      file.replace(/\.[0-9]{8}T[0-9]{6}Z\.jsonl$/, ''),
      readFileSync(join(folder, file), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Line)
        .filter((line) => line.event === 'tool.call')
        .map((line) => `${String(line.tool)}:${String(line.outcome)}`)
    ])
  )
}

const withClone = async (
  repo: string,
  home: string,
  session: string,
  fn: (spawned: SpawnedServer) => Promise<void>
): Promise<void> => {
  const spawned = await spawnServer({
    projectRoot: repo,
    entry: ENTRY,
    env: { HOME: home, CLAUDE_CODE_SESSION_ID: session }
  })
  try {
    await fn(spawned)
  } finally {
    await spawned.close()
  }
}

const cloneCall = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await spawned.client.callTool({ name, arguments: args })) as CallToolResult

test('metrics.cross-clone-resume-goes-to-named', async () => {
  await import('../../../src/metrics/record.ts')
  const root = mkdtempSync(join(tmpdir(), 'logbook-metrics-clones-'))
  try {
    const origin = join(root, 'origin.git')
    mustGit(root, ['init', '--bare', '--initial-branch=main', origin])
    const first = makeRepo()
    const second = makeRepo()
    const firstHome = mkdtempSync(join(root, 'home-a-'))
    const secondHome = mkdtempSync(join(root, 'home-b-'))
    try {
      mustGit(second, ['remote', 'add', 'origin', origin])
      await withClone(first, firstHome, 's-a', async (spawned) => {
        assertSucceeded(await cloneCall(spawned, 'open_thread', OPEN_ARGS))
      })
      mustGit(first, ['remote', 'add', 'origin', origin])
      mustGit(first, ['push', '--quiet', 'origin', `+${THREADS_REF}:${THREADS_REF}`])
      await withClone(second, secondHome, 's-b', async (spawned) => {
        assertSucceeded(await cloneCall(spawned, 'open_thread', { ...OPEN_ARGS, slug: 'other-thread' }))
        assertSucceeded(await cloneCall(spawned, 'resume_thread', { thread_id: 'fix-login' }))
      })
      assert.deepEqual(toolCallsByThread(secondHome, second), {
        'fix-login': ['resume_thread:ok'],
        'other-thread': ['open_thread:ok']
      })
    } finally {
      rmSync(first, { recursive: true, force: true })
      rmSync(second, { recursive: true, force: true })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
