import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import type { SpawnedServer } from '../support/spawn-client.ts'
import {
  assertOkResult,
  readResourceText,
  readThreadResourceText,
  seedStore,
  withFixture,
  type SeededIds
} from '../support/resources-fixture.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { SESSION_FIRST_LINE_ENTRIES_MAX } from '../../src/server/resource-render.ts'

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

const RESUMABLE_CACHE_SUFFIX = `${sep}state${sep}resumable.json`

const isSanctionedReadTimeCache = (file: string): boolean => file.endsWith(RESUMABLE_CACHE_SUFFIX)

const assertSnapshotsIdentical = (before: StoreSnapshot, after: StoreSnapshot): void => {
  assert.equal(after.ledgerRef, before.ledgerRef, 'the ledger ref must not move as a result of a resource read')

  const unexpectedNew = [...after.files.keys()].filter(
    (file) => !before.files.has(file) && !isSanctionedReadTimeCache(file)
  )
  const unexpectedRemoved = [...before.files.keys()].filter((file) => !after.files.has(file))
  assert.deepEqual(
    unexpectedNew,
    [],
    'a resource read must not add any file other than the derived resumable-roster cache under state/'
  )
  assert.deepEqual(unexpectedRemoved, [], 'a resource read must not remove any file under records/ or state/')

  for (const [file, contentBefore] of before.files) {
    if (isSanctionedReadTimeCache(file)) continue
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

    await fx.spawned.client.listResources()

    const after = snapshotLayout(layout.value, fx.repo)
    assertSnapshotsIdentical(before, after)
  })
})


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

const ABSENT_SESSIONS_THREAD_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const SESSIONS_ABSENT_THREAD_REFUSAL = 'logbook://sessions: no thread record matches id'

test('resources.sessions-refuses-an-id-naming-no-thread-record', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)
    const uri = `logbook://sessions/${ABSENT_SESSIONS_THREAD_ID}`
    assert.notEqual(
      ids.sessionThreadId,
      ABSENT_SESSIONS_THREAD_ID,
      'expected the fixture to seed a thread id other than the absent one'
    )

    const outcome = await fx.spawned.client
      .readResource({ uri })
      .then((read) => ({ kind: 'resolved' as const, contentCount: read.contents.length }))
      .catch((error: unknown) => ({ kind: 'refused' as const, error }))

    assert.ok(
      outcome.kind === 'refused',
      `expected ${uri} to be refused, got a listing body carrying ${outcome.kind === 'resolved' ? outcome.contentCount : 0} content items`
    )
    const { error } = outcome
    assert.ok(error instanceof McpError, `expected the refusal to be an McpError, got ${String(error)}`)
    assert.equal(
      error.code,
      ErrorCode.InvalidParams,
      `expected the refusal to carry ErrorCode.InvalidParams, got ${error.code}`
    )
    assert.ok(
      error.message.includes(SESSIONS_ABSENT_THREAD_REFUSAL),
      `expected the refusal message to contain '${SESSIONS_ABSENT_THREAD_REFUSAL}', got '${error.message}'`
    )
  })
})

test('resource.sessions-caps-first-line-text-but-keeps-every-id', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)
    const total = SESSION_FIRST_LINE_ENTRIES_MAX + 3
    const entryIds: string[] = []
    for (let i = 0; i < total; i += 1) {
      entryIds.push(await logEntry(fx.spawned, ids.threadId, `cap fixture entry number ${i}`))
    }

    const listing = await readResourceText(fx.spawned, `logbook://sessions/${ids.threadId}`)

    for (const entryId of entryIds) {
      assert.ok(listing.includes(entryId), `expected the sessions listing to still name entry ${entryId}`)
    }
    assert.ok(
      !listing.includes('cap fixture entry number 0\n') && !listing.includes('cap fixture entry number 0]'),
      'expected the oldest entries beyond the cap to lose their first-line text'
    )
    assert.ok(
      listing.includes(`cap fixture entry number ${total - 1}`),
      'expected the newest entry to still show its first-line text'
    )
    const seededSessionEntryCount = 1
    const droppedCount = total + seededSessionEntryCount - SESSION_FIRST_LINE_ENTRIES_MAX
    assert.ok(
      listing.includes(`${droppedCount} entry first lines omitted`),
      `expected a note naming ${droppedCount} first lines omitted, got '${listing}'`
    )
  })
})

test('resource.sessions-still-answers-for-a-quarantined-thread-record', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    const rt = testRuntime({
      env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
      cwd: fx.repo
    })
    const layout = layoutFor(rt, fx.repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return

    const threadRecordPath = join(layout.value.records, 'threads', `${ids.threadId}.json`)
    writeFileSync(threadRecordPath, 'this is not valid json for a thread record')

    const listing = await readResourceText(fx.spawned, `logbook://sessions/${ids.threadId}`)

    assert.ok(
      listing.includes(ids.sessionEntryId),
      `expected the sessions listing to still name entry ${ids.sessionEntryId}`
    )
    assert.ok(
      listing.includes('thread record quarantined'),
      `expected the sessions listing to disclose the quarantined thread record, got '${listing}'`
    )
    assert.ok(listing.includes('invalid JSON'), 'expected the disclosure to carry the parse-failure reason')
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

test('resource.index-sessions-description-does-not-promise-a-first-line-for-every-entry', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const indexBody = await readIndexBody(fx.spawned)
    const sessionsLine = indexBody.split('\n').find((line) => line.startsWith('logbook://sessions/{thread_id}'))
    assert.ok(sessionsLine !== undefined, `expected logbook://index to carry a logbook://sessions/{thread_id} line, got '${indexBody}'`)
    assert.ok(
      !sessionsLine.includes('first line of each'),
      `expected the sessions description to stop promising a first line for every entry, got '${sessionsLine}'`
    )
    assert.ok(
      sessionsLine.includes(`newest ${SESSION_FIRST_LINE_ENTRIES_MAX} entries`),
      `expected the sessions description to name the ${SESSION_FIRST_LINE_ENTRIES_MAX}-entry first-line cap, got '${sessionsLine}'`
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

const BINDINGS_UNREAD_NOTE = 'bindings could not be read; none is claimed either way'

test('resource.thread-detail-degrades-when-bindings-cannot-be-read', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)
    const bound = (await fx.spawned.client.callTool({
      name: 'bind_branch',
      arguments: { thread_id: ids.threadId, branch: 'feat/unreadable-bindings-fixture-branch' }
    })) as CallToolResult
    assertOkResult('bind_branch (unreadable bindings fixture arrange)', bound)

    const rt = testRuntime({
      env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
      cwd: fx.repo
    })
    const layout = layoutFor(rt, fx.repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return

    const bindingsPath = join(layout.value.records, 'bindings')
    rmSync(bindingsPath, { recursive: true, force: true })
    writeFileSync(bindingsPath, 'this is a regular file, not a directory\n')

    const detailText = await readThreadResourceText(fx.spawned, ids.threadId)

    assert.ok(
      detailText.includes(`Id: ${ids.threadId}`),
      `expected the thread resource to still render its thread record, got '${detailText}'`
    )
    assert.ok(
      detailText.includes(BINDINGS_UNREAD_NOTE),
      `expected the thread resource to report its bindings unread, got '${detailText}'`
    )
    assert.ok(
      !detailText.includes(layout.value.root),
      'expected the thread resource to keep the store path out of the rendered body'
    )
  })
})

const DISTINCTIVE_TITLE_SENTENCE = 'the quartz falcon migrated northward before the census closed'

test('resource.list-carries-no-thread-title-prose', async () => {
  await withFixture(async (fx) => {
    await fx.spawned.client.listTools()
    const opened = (await fx.spawned.client.callTool({
      name: 'open_thread',
      arguments: {
        title: DISTINCTIVE_TITLE_SENTENCE,
        slug: 'title-prose-fixture-thread',
        completion_criteria: [{ text: 'a title prose fixture criterion', check: 'the title prose fixture check' }]
      }
    })) as CallToolResult
    assertOkResult('open_thread (title prose fixture arrange)', opened)
    const threadId = (opened.structuredContent as { thread_id: string }).thread_id

    const listed = await fx.spawned.client.listResources()
    const serialised = JSON.stringify(listed)

    assert.ok(
      !serialised.includes(DISTINCTIVE_TITLE_SENTENCE),
      `expected resources/list to carry no thread title prose, got '${serialised}'`
    )
    assert.ok(
      serialised.includes(`logbook://thread/${threadId}`),
      'expected resources/list to still name the thread by uri'
    )
    assert.ok(
      serialised.includes('title-prose-fixture-thread'),
      'expected resources/list to still name the thread by its slug'
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

test('resource.thread-detail-renders-resolved-dangling-and-quarantined-decisions-together', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    const secondDecision = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: ids.threadId,
        title: 'second thread-detail fixture decision',
        context: 'a second thread-detail fixture context',
        options: ['option a', 'option b'],
        outcome: 'chose option a'
      }
    })) as CallToolResult
    assertOkResult('record_decision (second thread-detail fixture decision)', secondDecision)
    const secondDecisionId = (secondDecision.structuredContent as { decision_id: string }).decision_id

    const thirdDecision = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: ids.threadId,
        title: 'third thread-detail fixture decision',
        context: 'a third thread-detail fixture context',
        options: ['option a', 'option b'],
        outcome: 'chose option a'
      }
    })) as CallToolResult
    assertOkResult('record_decision (third thread-detail fixture decision)', thirdDecision)
    const thirdDecisionId = (thirdDecision.structuredContent as { decision_id: string }).decision_id

    const rt = testRuntime({
      env: { HOME: fx.homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
      cwd: fx.repo
    })
    const layout = layoutFor(rt, fx.repo)
    assert.equal(layout.ok, true)
    if (!layout.ok) return

    rmSync(join(layout.value.records, 'decisions', `${secondDecisionId}.json`))
    writeFileSync(join(layout.value.records, 'decisions', `${thirdDecisionId}.json`), 'this is not valid json')

    const detail = await readThreadResourceText(fx.spawned, ids.threadId)

    assert.ok(detail.includes('resolved: 1'), `expected 'resolved: 1', got '${detail}'`)
    assert.ok(
      detail.includes(`dangling: ${secondDecisionId}`),
      `expected a dangling line for ${secondDecisionId}, got '${detail}'`
    )
    assert.ok(
      detail.includes(`quarantined: ${thirdDecisionId}`),
      `expected a quarantined line for ${thirdDecisionId}, got '${detail}'`
    )
  })
})
