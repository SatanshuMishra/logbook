import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const STAMP = /^[0-9]{8}T[0-9]{6}Z$/
const RUN_FILE = /^fix-login\.([0-9]{8}T[0-9]{6}Z)\.jsonl$/
const ENVELOPE = ['v', 'ts', 'plugin', 'plugin_version', 'kind', 'event', 'run', 'parent', 'session', 'repo']
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const OPEN_ARGS = {
  slug: 'fix-login',
  title: 'Fix the login page',
  goal: 'Users can log in again.',
  next_step: 'Fix the submit handler.'
}

type Line = Record<string, unknown>

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `logbook-metrics-${label}-`))

const makeRepo = (): string => {
  const repo = scratch('repo')
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFolders = async (labels: readonly string[], fn: (folders: string[]) => Promise<void>): Promise<void> => {
  const folders = labels.map((label) => (label === 'repo' ? makeRepo() : scratch(label)))
  try {
    await fn(folders)
  } finally {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true })
  }
}

const withServer = async (
  repo: string,
  env: Record<string, string>,
  fn: (spawned: SpawnedServer) => Promise<void>
): Promise<void> => {
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env })
  try {
    await fn(spawned)
  } finally {
    await spawned.close()
  }
}

const callTool = async (spawned: SpawnedServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await spawned.client.callTool({ name, arguments: args })) as CallToolResult

const assertSucceeded = (reply: CallToolResult): void => {
  assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
}

const eventFolder = (store: string, repoName: string): string =>
  join(store, 'plugin=logbook', 'kind=event', `repo=${repoName}`)

const summaryFolder = (store: string, repoName: string): string =>
  join(store, 'plugin=logbook', 'kind=summary', `repo=${repoName}`)

const filesIn = (folder: string): string[] => (existsSync(folder) ? readdirSync(folder).sort() : [])

const linesOf = (file: string): Line[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Line)

const onlyRunFile = (folder: string): string => {
  const files = filesIn(folder)
  assert.equal(files.length, 1, `expected exactly one run file in ${folder}, got: ${JSON.stringify(files)}`)
  const [file] = files
  assert.ok(file !== undefined && RUN_FILE.test(file), `unexpected run file name: ${file}`)
  return file
}

const packageVersion = (): unknown => (JSON.parse(readFileSync(join(LOGBOOK_ROOT, 'package.json'), 'utf8')) as Line).version

const fixLogin = (): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
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
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    ''
  ].join('\n')

const seedFixLogin = (repo: string, home: string): void => {
  const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 'seed', start: STORED_AT })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the test repository must be found')
  const seeded = commitDocuments(rt, found.value, {
    changes: [{ slug: 'fix-login', text: fixLogin(), expectedBlob: null }],
    message: 'open_thread fix-login: opened'
  })
  assert.ok(seeded.ok, 'the stored document must be seeded')
}

const withoutPath = (structured: unknown): Line => {
  const { path: _path, ...rest } = (structured ?? {}) as Line
  return rest
}

test('metrics.open-starts-a-run', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(['repo', 'home'], async ([repo = '', home = '']) => {
    await withServer(repo, { HOME: home, CLAUDE_CODE_SESSION_ID: 's-1' }, async (spawned) => {
      assertSucceeded(await callTool(spawned, 'open_thread', OPEN_ARGS))
    })
    const store = join(home, '.plugin-metrics')
    const folder = eventFolder(store, basename(repo))
    const file = onlyRunFile(folder)
    const stamp = RUN_FILE.exec(file)?.[1] ?? ''
    assert.match(stamp, STAMP)
    const lines = linesOf(join(folder, file))
    assert.equal(lines.length, 1)
    const [line] = lines
    assert.ok(line !== undefined)
    assert.deepEqual(Object.keys(line).slice(0, ENVELOPE.length), ENVELOPE)
    assert.equal(line.v, 1)
    assert.equal(line.plugin, 'logbook')
    assert.equal(line.plugin_version, packageVersion())
    assert.equal(line.kind, 'event')
    assert.equal(line.event, 'tool.call')
    assert.equal(line.run, file.slice(0, -'.jsonl'.length))
    assert.equal(line.parent, null)
    assert.equal(line.session, 's-1')
    assert.ok(existsSync(join(store, 'plugin=logbook', 'catalogue.json')), 'the catalogue must be copied')
  })
})

test('metrics.run-survives-a-restart', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(['repo', 'home'], async ([repo = '', home = '']) => {
    const env = { HOME: home, CLAUDE_CODE_SESSION_ID: 's-1' }
    await withServer(repo, env, async (spawned) => {
      assertSucceeded(await callTool(spawned, 'open_thread', OPEN_ARGS))
    })
    await withServer(repo, env, async (spawned) => {
      assertSucceeded(await callTool(spawned, 'resume_thread', { thread_id: 'fix-login' }))
    })
    const folder = eventFolder(join(home, '.plugin-metrics'), basename(repo))
    const file = onlyRunFile(folder)
    assert.deepEqual(
      linesOf(join(folder, file)).map((line) => [line.event, line.tool]),
      [
        ['tool.call', 'open_thread'],
        ['tool.call', 'resume_thread']
      ]
    )
  })
})

test('metrics.thread-before-metrics-gets-a-run', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(['repo', 'home'], async ([repo = '', home = '']) => {
    seedFixLogin(repo, home)
    const store = join(home, '.plugin-metrics')
    assert.equal(existsSync(store), false, 'no store may exist before the call')
    await withServer(repo, { HOME: home, CLAUDE_CODE_SESSION_ID: 's-1' }, async (spawned) => {
      assertSucceeded(await callTool(spawned, 'update_thread', { thread_id: 'fix-login', next_step: 'Run the build.' }))
    })
    const folder = eventFolder(store, basename(repo))
    const file = onlyRunFile(folder)
    assert.deepEqual(
      linesOf(join(folder, file))
        .filter((line) => line.event === 'tool.call')
        .map((line) => [line.event, line.tool]),
      [['tool.call', 'update_thread']]
    )
    assert.ok(existsSync(join(store, 'plugin=logbook', 'catalogue.json')), 'the catalogue must be copied')
  })
})

test('metrics.parent-from-environment', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(['repo', 'home'], async ([repo = '', home = '']) => {
    const env = {
      HOME: home,
      CLAUDE_CODE_SESSION_ID: 's-1',
      PLUGIN_METRICS_PARENT: 'pipeline/logbook-metrics.20261026T232525Z'
    }
    await withServer(repo, env, async (spawned) => {
      assertSucceeded(await callTool(spawned, 'open_thread', OPEN_ARGS))
    })
    const folder = eventFolder(join(home, '.plugin-metrics'), basename(repo))
    const [line] = linesOf(join(folder, onlyRunFile(folder)))
    assert.equal(line?.parent, 'pipeline/logbook-metrics.20261026T232525Z')
  })
})

test('metrics.worktree-shares-repo', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(['repo', 'home', 'beside'], async ([repo = '', home = '', beside = '']) => {
    const worktree = join(beside, 'linked-checkout')
    mustGit(repo, ['worktree', 'add', '-b', 'linked', worktree])
    await withServer(worktree, { HOME: home, CLAUDE_CODE_SESSION_ID: 's-1' }, async (spawned) => {
      assertSucceeded(await callTool(spawned, 'open_thread', OPEN_ARGS))
    })
    const store = join(home, '.plugin-metrics')
    onlyRunFile(eventFolder(store, basename(repo)))
    assert.deepEqual(filesIn(eventFolder(store, basename(worktree))), [])
  })
})

test('metrics.reopened-slug-starts-a-new-run', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(['repo', 'home'], async ([repo = '', home = '']) => {
    const store = join(home, '.plugin-metrics')
    const events = eventFolder(store, basename(repo))
    const summaries = summaryFolder(store, basename(repo))
    mkdirSync(events, { recursive: true })
    mkdirSync(summaries, { recursive: true })
    const oldEvent = join(events, 'fix-login.20200101T000000Z.jsonl')
    const oldSummary = join(summaries, 'fix-login.20200101T000000Z.json')
    const oldEventText =
      '{"v":1,"ts":"2020-01-01T00:00:00Z","plugin":"logbook","plugin_version":"0.1.0","kind":"event","event":"tool.call","run":"fix-login.20200101T000000Z","parent":null,"session":"s-0","repo":"earlier"}\n'
    const oldSummaryText =
      '{"v":1,"ts":"2020-01-01T00:10:00Z","plugin":"logbook","plugin_version":"0.1.0","kind":"summary","event":"run.summary","run":"fix-login.20200101T000000Z","parent":null,"session":"s-0","repo":"earlier"}\n'
    writeFileSync(oldEvent, oldEventText)
    writeFileSync(oldSummary, oldSummaryText)
    const oldEventBytes = readFileSync(oldEvent)
    const oldSummaryBytes = readFileSync(oldSummary)
    await withServer(repo, { HOME: home, CLAUDE_CODE_SESSION_ID: 's-1' }, async (spawned) => {
      assertSucceeded(await callTool(spawned, 'open_thread', OPEN_ARGS))
    })
    const newFiles = filesIn(events).filter((name) => name !== 'fix-login.20200101T000000Z.jsonl')
    assert.equal(newFiles.length, 1, `expected one new run file, got: ${JSON.stringify(filesIn(events))}`)
    const [newFile = ''] = newFiles
    const stamp = RUN_FILE.exec(newFile)?.[1]
    assert.ok(stamp !== undefined, `unexpected run file name: ${newFile}`)
    assert.ok(stamp > '20200101T000000Z', `the new stamp ${stamp} must sort after 20200101T000000Z`)
    assert.deepEqual(
      linesOf(join(events, newFile)).map((line) => line.tool),
      ['open_thread']
    )
    assert.deepEqual(readFileSync(oldEvent), oldEventBytes)
    assert.deepEqual(readFileSync(oldSummary), oldSummaryBytes)
  })
})

test('metrics.unwritable-store-keeps-replies', async () => {
  await import('../../../src/metrics/record.ts')
  await withFolders(
    ['repo', 'repo', 'home', 'home', 'blocked', 'store'],
    async ([firstRepo = '', secondRepo = '', firstHome = '', secondHome = '', blocked = '', writable = '']) => {
      const regularFile = join(blocked, 'not-a-folder')
      writeFileSync(regularFile, 'a regular file where the store should be\n')
      const run = async (repo: string, env: Record<string, string>): Promise<{ replies: CallToolResult[]; stderr: string }> => {
        const replies: CallToolResult[] = []
        let stderr = ''
        await withServer(repo, env, async (spawned) => {
          replies.push(await callTool(spawned, 'open_thread', OPEN_ARGS))
          replies.push(await callTool(spawned, 'update_thread', { thread_id: 'fix-login', next_step: 'Run the build.' }))
          replies.push(await callTool(spawned, 'park_thread', { thread_id: 'fix-login' }))
          stderr = spawned.stderr()
        })
        return { replies, stderr }
      }
      const unwritable = await run(firstRepo, {
        HOME: firstHome,
        CLAUDE_CODE_SESSION_ID: 's-1',
        PLUGIN_METRICS_DIR: regularFile
      })
      const healthy = await run(secondRepo, {
        HOME: secondHome,
        CLAUDE_CODE_SESSION_ID: 's-1',
        PLUGIN_METRICS_DIR: writable
      })
      assert.equal(unwritable.replies.length, 3)
      assert.equal(healthy.replies.length, 3)
      for (const reply of [...unwritable.replies, ...healthy.replies]) assertSucceeded(reply)
      unwritable.replies.forEach((reply, index) => {
        assert.deepEqual(withoutPath(reply.structuredContent), withoutPath(healthy.replies[index]?.structuredContent))
      })
      assert.ok(
        unwritable.stderr.split('\n').some((line) => line.includes('metrics not written: ')),
        `the unwritable server's stderr must log the writer's warning, got:\n${unwritable.stderr}`
      )
    }
  )
})
