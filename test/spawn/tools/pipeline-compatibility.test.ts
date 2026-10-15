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
const SESSION = 'pipeline-session'
const SLUG = 'export-report'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

type Seed = { aliases: Record<string, string> }

type Call = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const migratedDocument = (): string => {
  const lines = [
    `# ${SLUG}: Export the monthly report`,
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D2 R1 S1',
    '',
    '## Goal',
    '',
    'The monthly report can be exported as a spreadsheet.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The export button writes a spreadsheet',
    '',
    '## Where things stand',
    '',
    'The export query returns every row.',
    '',
    '## Next step',
    '',
    'Write the spreadsheet writer.',
    '',
    '## Decisions in force',
    '',
    '- D1 Write the file on the server: the browser cannot hold every row',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/export.md'
  ]
  return `${lines.join('\n')}\n`
}

const seedThread = (repo: string, home: string, seed: Seed): void => {
  const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 'seed', start: STORED_AT })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the test repository must be found')
  const seeded = commitDocuments(rt, found.value, {
    changes: [{ slug: SLUG, text: migratedDocument(), expectedBlob: null }],
    message: `open_thread ${SLUG}: opened`,
    aliases: seed.aliases
  })
  assert.ok(seeded.ok, 'the migrated document must be seeded')
}

const withPipelineSession = async (seed: Seed | null, fn: (call: Call) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-pipeline-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-pipeline-home-'))
  try {
    initRepo(repo)
    if (seed !== null) seedThread(repo, home, seed)
    const spawned: SpawnedServer = await spawnServer({
      projectRoot: repo,
      entry: ENTRY,
      env: { CLAUDE_CODE_SESSION_ID: SESSION, HOME: home }
    })
    try {
      await fn(async (name, args) => (await spawned.client.callTool({ name, arguments: args })) as CallToolResult)
    } finally {
      await spawned.close()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
}

const textOf = (reply: CallToolResult): string => {
  const first = reply.content[0]
  assert.ok(first !== undefined && first.type === 'text', 'the reply must carry a text content block')
  return first.text
}

const readsAsRefusalText = (text: string): boolean => {
  const lines = text.split('\n')
  const field = lines.findIndex((line) => line.startsWith('field: '))
  return field >= 0 && lines.slice(field + 1).some((line) => line.startsWith('accepted: '))
}

const assertAnswered = (reply: CallToolResult): void => {
  assert.notEqual(reply.isError, true, `expected success, got: ${JSON.stringify(reply)}`)
  assert.equal(readsAsRefusalText(textOf(reply)), false, `the reply must not read as a refusal, got:\n${textOf(reply)}`)
}

const structured = (reply: CallToolResult): Record<string, unknown> => {
  const content = reply.structuredContent
  assert.ok(content !== undefined && content !== null, `the reply must carry structured content, got: ${JSON.stringify(reply)}`)
  return content
}

const openAndResume = async (call: Call): Promise<void> => {
  assertAnswered(
    await call('open_thread', {
      slug: SLUG,
      title: 'Export the monthly report',
      goal: 'The monthly report can be exported as a spreadsheet.',
      next_step: 'Write the export query.',
      criteria: ['The export button writes a spreadsheet']
    })
  )
  assertAnswered(await call('resume_thread', { thread_id: SLUG }))
}

const boundaryDecision = {
  thread_id: SLUG,
  title: 'interphase hand-off',
  context: 'The spec and its steps are written and reviewed.',
  options: ['build', 'stop'],
  option_reasons: ['spec green', 'nothing to build'],
  outcome: 'build'
}

test('pipeline.resume-by-thread-id', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withPipelineSession(null, async (call) => {
    assertAnswered(
      await call('open_thread', {
        slug: SLUG,
        title: 'Export the monthly report',
        goal: 'The monthly report can be exported as a spreadsheet.',
        next_step: 'Write the export query.'
      })
    )
    const reply = await call('resume_thread', { thread_id: SLUG })

    assertAnswered(reply)
    assert.equal(structured(reply).thread_id, 'export-report')
  })
})

test('pipeline.resume-with-full-briefing', async () => {
  await import('../../../src/server/tools/resume_thread.ts')
  await withPipelineSession(null, async (call) => {
    await openAndResume(call)
    const reply = await call('resume_thread', { thread_id: SLUG, full_briefing: true })

    assertAnswered(reply)
    assert.equal(structured(reply).thread_id, 'export-report')
  })
})

test('pipeline.record-a-boundary-decision', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withPipelineSession(null, async (call) => {
    await openAndResume(call)
    const reply = await call('record_decision', boundaryDecision)

    assertAnswered(reply)
  })
})

test('pipeline.refused-decision-reads-as-refused', async () => {
  await import('../../../src/server/tools/record_decision.ts')
  await withPipelineSession(null, async (call) => {
    await openAndResume(call)
    const reply = await call('record_decision', {
      ...boundaryDecision,
      options: ['build'],
      option_reasons: ['spec green']
    })

    assert.equal(reply.isError, true, `expected a refusal, got: ${JSON.stringify(reply)}`)
    const lines = textOf(reply).split('\n')
    const field = lines.findIndex((line) => line.startsWith('field: '))
    assert.ok(field >= 0, `the refusal must have a line starting "field: ", got:\n${textOf(reply)}`)
    const accepted = lines.findIndex((line, index) => index > field && line.startsWith('accepted: '))
    assert.ok(accepted > field, `a line starting "accepted: " must follow the field line, got:\n${textOf(reply)}`)
  })
})

test('pipeline.update-with-next-step-records', async () => {
  await import('../../../src/server/tools/update_thread.ts')
  await withPipelineSession(null, async (call) => {
    await openAndResume(call)
    const decided = await call('record_decision', boundaryDecision)
    assertAnswered(decided)
    assert.equal(structured(decided).decision_id, 'D1')

    const reply = await call('update_thread', { thread_id: SLUG, next_step: 'run mitosis', next_step_records: ['D1'] })

    assertAnswered(reply)
  })
})

test('pipeline.park-reads-as-parked', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  await withPipelineSession(null, async (call) => {
    await openAndResume(call)
    const reply = await call('park_thread', {})

    assertAnswered(reply)
    assert.ok(textOf(reply).startsWith('parked thread'), `the reply text must start "parked thread", got:\n${textOf(reply)}`)
    const parked = structured(reply).parked_thread_ids
    assert.ok(Array.isArray(parked), `parked_thread_ids must be a list, got: ${JSON.stringify(parked)}`)
    assert.ok(parked.includes('export-report'), `parked_thread_ids must hold the slug, got: ${JSON.stringify(parked)}`)
  })
})

test('pipeline.park-names-the-old-id', async () => {
  await import('../../../src/server/tools/park_thread.ts')
  const oldId = ulid()
  await withPipelineSession({ aliases: { [oldId]: SLUG } }, async (call) => {
    const resumed = await call('resume_thread', { thread_id: oldId })
    assertAnswered(resumed)
    assert.equal(structured(resumed).thread_id, 'export-report')

    const reply = await call('park_thread', {})

    assertAnswered(reply)
    assert.ok(textOf(reply).startsWith('parked thread'), `the reply text must start "parked thread", got:\n${textOf(reply)}`)
    const parked = structured(reply).parked_thread_ids
    assert.ok(Array.isArray(parked), `parked_thread_ids must be a list, got: ${JSON.stringify(parked)}`)
    assert.ok(parked.includes(oldId), `parked_thread_ids must hold the old id ${oldId}, got: ${JSON.stringify(parked)}`)
  })
})

test('pipeline.close-by-thread-id', async () => {
  await import('../../../src/server/tools/close_thread.ts')
  await withPipelineSession(null, async (call) => {
    await openAndResume(call)
    const reply = await call('close_thread', { thread_id: SLUG, outcome: 'abandoned', detail: 'test' })

    assertAnswered(reply)
  })
})
