import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { selectRosterThreads, toRosterRow } from '../../src/render/roster.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit } from '../support/git-fixture.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const withLineageFixture = async (fn: (rt: Runtime) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-lineage-repo-'))
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-lineage-plugin-data-'))
  try {
    rawGit(repo, ['init', '--initial-branch=main'])
    rawGit(repo, ['config', 'user.name', 'Logbook Lineage Fixture'])
    rawGit(repo, ['config', 'user.email', 'lineage@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook lineage fixture repository\n')
    rawGit(repo, ['add', 'README.md'])
    rawGit(repo, ['commit', '-m', 'fixture: initial commit'])
    await fn(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo }))
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

test('lineage.briefing-renders-the-predecessor-it-was-opened-with', async () => {
  await withLineageFixture(async (rt) => {
    const first = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'The thread that came first',
      slug: 'came-first',
      completion_criteria: ['the first criterion']
    })
    assert.equal(first.ok, true)
    if (!first.ok) throw new Error('expected the predecessor thread to open')

    const second = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'The thread that succeeds it',
      slug: 'succeeds-it',
      completion_criteria: ['the second criterion'],
      predecessor_id: first.structured.thread_id
    })
    assert.equal(second.ok, true)
    if (!second.ok) throw new Error('expected the successor thread to open')

    const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: second.structured.thread_id
    })
    assert.equal(resumed.ok, true)
    if (!resumed.ok) throw new Error('expected the successor thread to resume')

    const lines = resumed.structured.briefing.split('\n')
    const relatedIndex = lines.indexOf('Related:')
    assert.notEqual(relatedIndex, -1)
    assert.equal(lines[relatedIndex + 1], '- succeeds: The thread that came first (came-first)')
  })
})

test('lineage.unresolvable-predecessor-is-refused-at-write-time', async () => {
  await withLineageFixture(async (rt) => {
    const refused = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'A thread naming a predecessor that does not exist',
      slug: 'dangling-predecessor',
      completion_criteria: ['the only criterion'],
      predecessor_id: rt.ulid()
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected open_thread to refuse an unresolvable predecessor_id')
    assert.equal(refused.refusal.field, 'predecessor_id')

    const opened = openStore(rt, rt.cwd)
    assert.equal(opened.ok, true)
    if (!opened.ok) throw new Error('expected the lineage fixture store to open')
    assert.equal(opened.value.readThreads().length, 0)
  })
})

test('lineage.a-record-written-before-this-change-still-parses-and-rosters', async () => {
  await withLineageFixture(async (rt) => {
    const opened = openStore(rt, rt.cwd)
    assert.equal(opened.ok, true)
    if (!opened.ok) throw new Error('expected the lineage fixture store to open')
    const store = opened.value

    const legacyId = rt.ulid()
    const legacy: Extract<RecordChange, { kind: 'thread' }> = {
      kind: 'thread',
      record: {
        id: legacyId,
        slug: 'written-before-lineage',
        title: 'A thread written before lineage existed',
        status: 'open',
        blocked_by: null,
        completion_criteria: [],
        spine: {
          active_goal: 'the goal',
          next_step: 'the next step',
          last_session: 'the last session',
          open_risks: [],
          key_decisions: [],
          out_of_scope: []
        },
        created_at: rt.now(),
        updated_at: rt.now()
      }
    }

    assert.equal(JSON.stringify(legacy.record).includes('predecessor_id'), false)

    const committed = store.commit([legacy], 'fixture: a thread written before lineage')
    assert.equal(committed.ok, true)

    const slot = store.readThread(legacyId)
    assert.notEqual(slot, null)
    assert.equal(slot === null ? true : slot.quarantined, false)

    const rows = selectRosterThreads(store.readThreads().flatMap((s) => (s.quarantined ? [] : [s.record]))).map(
      toRosterRow
    )
    assert.equal(
      rows.some((row) => row.slug === 'written-before-lineage'),
      true
    )
  })
})
