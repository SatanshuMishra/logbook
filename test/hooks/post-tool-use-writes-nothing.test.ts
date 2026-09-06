import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { openStore } from '../../src/store/records.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { writePointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { TREE_ROOT, controlledEnv, readFixture, runHookProcess } from './hook-process.ts'

const SESSION_ID = 'post-tool-use-writes-nothing-session'
const COMMIT_SHAPED_COMMAND = 'git commit -m "a project commit made during this session"'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-post-tool-use-plugin-data-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: 'a post tool use thread',
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

test('hook.post-tool-use-writes-nothing-for-a-commit-shaped-command', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const env = { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }
      const rt = testRuntime({ env, cwd: repo })

      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const seeded = makeThread(rt, 'post-tool-use-writes-nothing')
      const committed = opened.value.commit([seeded], 'seed one open thread')
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      writePointer(rt, layout.value, {
        thread_id: seeded.record.id,
        written_at: '2024-01-01T00:00:00.000Z',
        session_id: SESSION_ID
      })

      const ledgerHead = (): string => rawGit(repo, ['rev-parse', 'refs/logbook/ledger']).stdout.trim()
      const before = ledgerHead()
      assert.notEqual(before, '', 'the fixture must leave the ledger ref pointing at a commit')

      const fixture = readFixture('post-tool-use.json') as object
      const event = {
        ...fixture,
        session_id: SESSION_ID,
        cwd: repo,
        tool_name: 'Bash',
        tool_input: { command: COMMIT_SHAPED_COMMAND }
      }
      const result = runHookProcess('post-tool-use', JSON.stringify(event), {
        env: controlledEnv({ HOME: process.env.HOME ?? '', CLAUDE_PLUGIN_DATA: pluginData })
      })

      assert.equal(result.status, 0, `post-tool-use exited nonzero: ${result.stderr}`)
      assert.deepEqual(JSON.parse(result.stdout), {}, 'the PostToolUse hook must emit an empty object')
      assert.equal(
        ledgerHead(),
        before,
        'the PostToolUse hook must no longer write a commit note into the ledger'
      )
    })
  })
})

test('hook.post-tool-use-carries-no-commit-note-module', () => {
  assert.equal(
    existsSync(join(TREE_ROOT, 'src', 'hooklib', 'commit-note.ts')),
    false,
    'the commit-note module must be deleted with the write it existed to perform'
  )
})
