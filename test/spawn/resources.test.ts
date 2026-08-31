import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(PROJECT_ROOT, 'bin', 'logbook-server.ts')

type Fixture = {
  spawned: SpawnedServer
  repo: string
  pluginData: string
  homeDir: string
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`resources fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const bootstrapRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-resources-repo-'))
  runSetupStep(repo, ['init', '--initial-branch=main'])
  runSetupStep(repo, ['config', 'user.name', 'Logbook Resources Fixture'])
  runSetupStep(repo, ['config', 'user.email', 'resources@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook resources fixture repository\n')
  runSetupStep(repo, ['add', 'README.md'])
  runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = bootstrapRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-resources-plugin-data-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-resources-home-'))
  const spawned = await spawnServer({ projectRoot: repo, entry: ENTRY, env: { CLAUDE_PLUGIN_DATA: pluginData } })
  try {
    await fn({ spawned, repo, pluginData, homeDir })
  } finally {
    await spawned.close()
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

const assertOkResult = (toolName: string, result: CallToolResult): void => {
  assert.notEqual(result.isError, true, `${toolName} expected a successful call, got a refusal: ${JSON.stringify(result.content)}`)
}

type SeededIds = { threadId: string; decisionId: string; sessionThreadId: string; sessionEntryId: string }

const seedStore = async (spawned: SpawnedServer): Promise<SeededIds> => {
  await spawned.client.listTools()

  const opened = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'resources fixture thread',
      slug: 'resources-fixture-thread',
      completion_criteria: [{ text: 'a resources fixture criterion', check: 'the resources fixture check' }]
    }
  })) as CallToolResult
  assertOkResult('open_thread (resources fixture arrange)', opened)
  const openedStructured = opened.structuredContent as { thread_id: string }
  const threadId = openedStructured.thread_id

  const decision = (await spawned.client.callTool({
    name: 'record_decision',
    arguments: {
      thread_id: threadId,
      title: 'resources fixture decision',
      context: 'a resources fixture context',
      options: ['option a', 'option b'],
      outcome: 'chose option a'
    }
  })) as CallToolResult
  assertOkResult('record_decision (resources fixture arrange)', decision)
  const decisionStructured = decision.structuredContent as { decision_id: string }
  const decisionId = decisionStructured.decision_id

  const sessionEvent = (await spawned.client.callTool({
    name: 'log_session_event',
    arguments: { thread_id: threadId, actor: 'claude', body: 'a resources fixture session entry' }
  })) as CallToolResult
  assertOkResult('log_session_event (resources fixture arrange)', sessionEvent)
  const sessionStructured = sessionEvent.structuredContent as { thread_id: string; session_entry_id: string }

  return {
    threadId,
    decisionId,
    sessionThreadId: sessionStructured.thread_id,
    sessionEntryId: sessionStructured.session_entry_id
  }
}

type ThreadDetailIds = { threadId: string; criterionIds: string[]; riskIds: string[] }

const seedThreadWithRisksAndCriteria = async (spawned: SpawnedServer): Promise<ThreadDetailIds> => {
  await spawned.client.listTools()

  const opened = (await spawned.client.callTool({
    name: 'open_thread',
    arguments: {
      title: 'thread detail fixture thread',
      slug: 'thread-detail-fixture-thread',
      completion_criteria: [
        { text: 'the first thread detail criterion', check: 'the first thread detail check' },
        { text: 'the second thread detail criterion', check: 'the second thread detail check' }
      ]
    }
  })) as CallToolResult
  assertOkResult('open_thread (thread detail fixture arrange)', opened)
  const openedStructured = opened.structuredContent as {
    thread_id: string
    completion_criteria: { id: string; ordinal: number; text: string }[]
  }
  const threadId = openedStructured.thread_id
  const criterionIds = openedStructured.completion_criteria.map((criterion) => criterion.id)

  const updated = (await spawned.client.callTool({
    name: 'update_thread',
    arguments: {
      thread_id: threadId,
      risks_add: [
        { text: 'the first thread detail risk', scope: 'the first thread detail criterion' },
        { text: 'the second thread detail risk', scope: 'the second thread detail criterion' }
      ]
    }
  })) as CallToolResult
  assertOkResult('update_thread (thread detail fixture arrange)', updated)
  const updatedStructured = updated.structuredContent as { risks_added: string[] }

  return { threadId, criterionIds, riskIds: updatedStructured.risks_added }
}

const parseIndexShapes = (indexBody: string): string[] =>
  indexBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf(' - ')
      return separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    })

const resolveShapeToUri = (shape: string, ids: SeededIds): string | null => {
  if (shape === 'logbook://index') return 'logbook://index'
  if (shape === 'logbook://roster') return 'logbook://roster'
  if (shape === 'logbook://thread/{id}') return `logbook://thread/${ids.threadId}`
  if (shape === 'logbook://decision/{id}') return `logbook://decision/${ids.decisionId}`
  if (shape === 'logbook://sessions/{thread_id}') return `logbook://sessions/${ids.sessionThreadId}`
  if (shape === 'logbook://session/{thread_id}/{entry_id}') {
    return `logbook://session/${ids.sessionThreadId}/${ids.sessionEntryId}`
  }
  return null
}

type ResolvedRead = { shape: string; verdict: 'allowed' | 'forbidden' | 'unclassifiable' }

const readIndexBody = async (spawned: SpawnedServer): Promise<string> => {
  const read = await spawned.client.readResource({ uri: 'logbook://index' })
  const [content] = read.contents
  assert.ok(content !== undefined && 'text' in content && typeof content.text === 'string', 'expected logbook://index to carry text content')
  return (content as { text: string }).text
}

test('resource.index-addresses-resolve', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const ids = await seedStore(fx.spawned)

    const indexBody = await readIndexBody(fx.spawned)
    const shapes = parseIndexShapes(indexBody)
    assert.ok(shapes.length > 0, 'expected logbook://index to list at least one address')

    const resolved: ResolvedRead[] = []
    for (const shape of shapes) {
      const uri = resolveShapeToUri(shape, ids)
      if (uri === null) {
        resolved.push({ shape, verdict: 'unclassifiable' })
        continue
      }
      try {
        const read = await fx.spawned.client.readResource({ uri })
        resolved.push({ shape, verdict: read.contents.length > 0 ? 'allowed' : 'forbidden' })
      } catch {
        resolved.push({ shape, verdict: 'forbidden' })
      }
    }

    const classifyForwardResolution = (r: ResolvedRead): Classified<ResolvedRead>['verdict'] | 'unclassifiable' => r.verdict
    assert.doesNotThrow(() => census(resolved, classifyForwardResolution))

    const listedResources = await fx.spawned.client.listResources()
    const listedTemplates = await fx.spawned.client.listResourceTemplates()
    const registeredShapes = [
      ...listedResources.resources.map((r) => r.uri),
      ...listedTemplates.resourceTemplates.map((t) => t.uriTemplate)
    ]
    assert.ok(registeredShapes.length > 0, 'expected the server to register at least one resource or template')

    const indexShapeSet = new Set(shapes)
    const indexTemplates = shapes.map((shape) => new UriTemplate(shape))
    const classifyRegisteredAgainstIndex = (registered: string): 'allowed' | 'unclassifiable' => {
      if (indexShapeSet.has(registered)) return 'allowed'
      return indexTemplates.some((template) => template.match(registered) !== null) ? 'allowed' : 'unclassifiable'
    }
    assert.doesNotThrow(() => census(registeredShapes, classifyRegisteredAgainstIndex))
  })
})

type StoreSnapshot = { files: Map<string, string>; ledgerRef: string }

const walkFiles = (root: string): string[] => {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walkFiles(join(root, entry.name)) : entry.isFile() ? [join(root, entry.name)] : []
    )
  } catch {
    return []
  }
  out.push(...entries)
  return out
}

const snapshotLayout = (layout: StoreLayout, repo: string): StoreSnapshot => {
  const files = new Map<string, string>()
  for (const root of [layout.records, layout.state]) {
    for (const file of walkFiles(root)) {
      files.set(file, readFileSync(file, 'utf8'))
    }
  }
  const ledgerRef = rawGit(repo, ['rev-parse', LEDGER_REF]).stdout.trim()
  return { files, ledgerRef }
}

const assertSnapshotsIdentical = (before: StoreSnapshot, after: StoreSnapshot): void => {
  assert.equal(after.ledgerRef, before.ledgerRef, 'the ledger ref must not move as a result of a resource read')
  assert.deepEqual(
    [...after.files.keys()].sort(),
    [...before.files.keys()].sort(),
    'a resource read must not add or remove files under records/ or state/'
  )
  for (const [file, contentBefore] of before.files) {
    assert.equal(after.files.get(file), contentBefore, `a resource read must not change the contents of ${file}`)
  }
}

test('resource.read-is-pure', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const ids = await seedStore(fx.spawned)

    const rt = testRuntime({
      env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
      cwd: fx.repo
    })
    const layout = layoutFor(rt, fx.repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return

    const indexBody = await readIndexBody(fx.spawned)
    const shapes = parseIndexShapes(indexBody)
    const urisToRead = shapes
      .map((shape) => resolveShapeToUri(shape, ids))
      .filter((uri): uri is string => uri !== null)
    assert.ok(urisToRead.length > 0)

    const before = snapshotLayout(layout.value, fx.repo)

    for (const uri of urisToRead) {
      await fx.spawned.client.readResource({ uri })
    }
    for (const uri of urisToRead) {
      await fx.spawned.client.readResource({ uri })
    }

    const after = snapshotLayout(layout.value, fx.repo)
    assertSnapshotsIdentical(before, after)
  })
})

const readThreadResourceText = async (spawned: SpawnedServer, threadId: string): Promise<string> => {
  const read = await spawned.client.readResource({ uri: `logbook://thread/${threadId}` })
  const [content] = read.contents
  assert.ok(
    content !== undefined && 'text' in content && typeof content.text === 'string',
    'expected logbook://thread to return text content'
  )
  return (content as { text: string }).text
}

test('resource.thread-detail-shows-every-risk-and-criterion-id', async () => {
  await withFixture(async (fx) => {
    const ids = await seedThreadWithRisksAndCriteria(fx.spawned)
    assert.equal(ids.criterionIds.length, 2, 'expected the fixture to mint two criterion ids')
    assert.equal(ids.riskIds.length, 2, 'expected the fixture to mint two risk ids')

    const detailText = await readThreadResourceText(fx.spawned, ids.threadId)

    for (const criterionId of ids.criterionIds) {
      assert.ok(
        detailText.includes(criterionId),
        `expected the thread resource to contain criterion id ${criterionId}`
      )
    }
    for (const riskId of ids.riskIds) {
      assert.ok(detailText.includes(riskId), `expected the thread resource to contain risk id ${riskId}`)
    }
  })
})

const readResourceText = async (spawned: SpawnedServer, uri: string): Promise<string> => {
  const read = await spawned.client.readResource({ uri })
  const [content] = read.contents
  assert.ok(
    content !== undefined && 'text' in content && typeof content.text === 'string',
    `expected ${uri} to return text content`
  )
  return (content as { text: string }).text
}

const logEntry = async (spawned: SpawnedServer, threadId: string, body: string): Promise<string> => {
  const result = (await spawned.client.callTool({
    name: 'log_session_event',
    arguments: { thread_id: threadId, actor: 'claude', body }
  })) as CallToolResult
  assertOkResult('log_session_event (sessions fixture arrange)', result)
  return (result.structuredContent as { session_entry_id: string }).session_entry_id
}

test('resource.sessions-lists-every-entry-id-with-its-first-line', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)
    const olderId = await logEntry(fx.spawned, ids.threadId, 'the older first line\nthe older second line')
    const newerId = await logEntry(fx.spawned, ids.threadId, 'the newer first line\nthe newer second line')

    const listing = await readResourceText(fx.spawned, `logbook://sessions/${ids.threadId}`)

    assert.ok(listing.includes(olderId), `expected the sessions resource to name entry ${olderId}`)
    assert.ok(listing.includes(newerId), `expected the sessions resource to name entry ${newerId}`)
    assert.ok(listing.includes('the older first line'), 'expected the sessions resource to show the older first line')
    assert.ok(listing.includes('the newer first line'), 'expected the sessions resource to show the newer first line')
    assert.ok(
      !listing.includes('the older second line'),
      'expected the sessions resource to show the first line only'
    )
    assert.ok(
      listing.indexOf(newerId) < listing.indexOf(olderId),
      'expected the sessions resource to render newest first'
    )
  })
})

test('resource.index-lists-the-sessions-address', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const indexBody = await readIndexBody(fx.spawned)
    assert.ok(
      parseIndexShapes(indexBody).includes('logbook://sessions/{thread_id}'),
      'expected logbook://index to list logbook://sessions/{thread_id}'
    )
  })
})

test('resource.thread-detail-shows-every-binding', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)
    const bound = (await fx.spawned.client.callTool({
      name: 'bind_branch',
      arguments: { thread_id: ids.threadId, branch: 'feat/resources-fixture-branch' }
    })) as CallToolResult
    assertOkResult('bind_branch (bindings fixture arrange)', bound)
    const bindingId = (bound.structuredContent as { binding_id: string }).binding_id

    const detailText = await readThreadResourceText(fx.spawned, ids.threadId)

    assert.ok(detailText.includes(bindingId), `expected the thread resource to name binding ${bindingId}`)
    assert.ok(
      detailText.includes('feat/resources-fixture-branch'),
      'expected the thread resource to name the bound branch'
    )
  })
})

test('resource.list-enumerates-open-threads-and-not-decisions-or-session-entries', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    const listed = await fx.spawned.client.listResources()
    const uris = listed.resources.map((resource) => resource.uri)

    assert.ok(uris.length > 2, `expected resources/list to return more than two entries, got ${uris.length}`)
    assert.ok(uris.includes(`logbook://thread/${ids.threadId}`), 'expected resources/list to name the open thread')
    assert.ok(
      !uris.includes(`logbook://decision/${ids.decisionId}`),
      'expected resources/list to leave decision records unenumerated'
    )
    assert.ok(
      !uris.includes(`logbook://session/${ids.sessionThreadId}/${ids.sessionEntryId}`),
      'expected resources/list to leave session entries unenumerated'
    )

    const closed = (await fx.spawned.client.callTool({
      name: 'close_thread',
      arguments: { thread_id: ids.threadId, outcome: 'abandoned', detail: 'the fixture thread is no longer pursued' }
    })) as CallToolResult
    assertOkResult('close_thread (list fixture arrange)', closed)

    const afterClose = await fx.spawned.client.listResources()
    assert.ok(
      !afterClose.resources.map((resource) => resource.uri).includes(`logbook://thread/${ids.threadId}`),
      'expected resources/list to drop a terminal thread'
    )
  })
})
