import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { HOOK_EVENT_FIELDS, HOOK_TOOL_NAME } from '../../../src/server/hook-tool.ts'
import { takeHold } from '../../../src/thread/holds.ts'
import { listMarkers } from '../../../src/thread/inflight.ts'
import { findRepository, type RepoPaths } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

type Fixture = { repo: string; home: string; store: string; paths: RepoPaths; server: SpawnedServer }

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const SLUG = 'work'
const SESSION = 's1'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const workDocument = (): string => {
  const lines = [
    '# work: Finish the work',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    'The work is finished.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The work ships',
    '',
    '## Where things stand',
    '',
    'Nothing is built yet.',
    '',
    '## Next step',
    '',
    'Start the work.',
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

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const seedThread = (repo: string, home: string): RepoPaths => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  const rt = testRuntime({ start: new Date().toISOString(), cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: SESSION })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the test repository must be found')
  const seeded = commitDocuments(rt, found.value, {
    changes: [{ slug: SLUG, text: workDocument(), expectedBlob: null }],
    message: 'open_thread work: opened'
  })
  assert.ok(seeded.ok, 'the stored document must be seeded')
  takeHold(rt, found.value, SLUG, SESSION, null)
  return found.value
}

const withServer = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-hook-tool-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-hook-tool-home-'))
  const store = mkdtempSync(join(tmpdir(), 'logbook-hook-tool-metrics-'))
  try {
    const paths = seedThread(repo, home)
    const server = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { HOME: home, PLUGIN_METRICS_DIR: store } })
    try {
      await fn({ repo, home, store, paths, server })
    } finally {
      await server.close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    rmSync(store, { recursive: true, force: true })
  }
}

const preToolUseFields = (fixture: Fixture): Record<string, string> => ({
  ...Object.fromEntries(HOOK_EVENT_FIELDS.map((field) => [field, ''])),
  hook_event_name: 'PreToolUse',
  session_id: SESSION,
  cwd: fixture.repo,
  tool_name: 'Bash',
  tool_input: JSON.stringify({ command: 'npm test' }),
  tool_use_id: 'toolu_11'
})

const callHookTool = async (fixture: Fixture, args: Record<string, string>): Promise<CallToolResult> =>
  (await fixture.server.client.callTool({ name: HOOK_TOOL_NAME, arguments: args })) as CallToolResult

const textsOf = (result: CallToolResult): string[] =>
  result.content.map((block) => (block.type === 'text' ? block.text : ''))

const filesUnder = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))

const metricLines = (store: string): Record<string, unknown>[] =>
  filesUnder(store).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  )

test('hook_event.spawn.contract', async () => {
  await withServer(async (fixture) => {
    const result = await callHookTool(fixture, preToolUseFields(fixture))

    assert.equal(result.isError, undefined, `expected no error, got ${JSON.stringify(result)}`)
    assert.deepEqual(textsOf(result), ['{}'])
    assert.ok(listMarkers(fixture.paths, SLUG).some((marker) => marker.tool_use_id === 'toolu_11'))
    const hookCalls = metricLines(fixture.store).filter((line) => line.event === 'tool.call' && line.tool === HOOK_TOOL_NAME)
    assert.deepEqual(hookCalls, [])
  })
})

test('hook_event.rejects-invalid', async () => {
  await withServer(async (fixture) => {
    const result = await callHookTool(fixture, { ...preToolUseFields(fixture), surprise: 'x' })

    assert.equal(result.isError, true, `expected an error, got ${JSON.stringify(result)}`)
    assert.ok(textsOf(result).join('\n').includes('surprise'), JSON.stringify(result))
  })
})
