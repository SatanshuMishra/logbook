import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SEEDED_RECORD_COUNT = 3
const PLUGIN_DATA_DIR_NAME = 'relative-plugin-data'

const runtimeWithPluginData = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withAbsolutePluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-relative-plugin-data-seed-'))
  const dir = join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const withDisposableCwd = <T>(fn: (disposableCwd: string) => T): T => {
  const disposableCwd = mkdtempSync(join(tmpdir(), 'logbook-relative-plugin-data-cwd-'))
  const originalCwd = process.cwd()
  process.chdir(disposableCwd)
  try {
    return fn(disposableCwd)
  } finally {
    process.chdir(originalCwd)
    rmSync(disposableCwd, { recursive: true, force: true })
  }
}

const filesUnder = (dir: string): string[] => {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        out.push(relative(dir, full))
      }
    }
  }
  walk(dir)
  return out.sort()
}

const makeThread = (rt: Runtime, slug: string): Extract<RecordChange, { kind: 'thread' }> => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: `thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      landed: '',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

test('store.materialisation-never-writes-into-the-host-project-tree', () => {
  withRepo((repo) => {
    withAbsolutePluginData((seedPluginData) => {
      const seedRt = runtimeWithPluginData(seedPluginData)
      const seeded = openStore(seedRt, repo)
      assert.equal(seeded.ok, true, 'the fixture requires a working store to seed records the relative-plugin-data open must materialise')
      if (!seeded.ok) return

      const changes: RecordChange[] = []
      for (let index = 0; index < SEEDED_RECORD_COUNT; index += 1) {
        changes.push(makeThread(seedRt, `relative-plugin-data-${index}`))
      }
      const committed = seeded.value.commit(changes, `seed ${SEEDED_RECORD_COUNT} threads onto the ledger ref`)
      assert.equal(committed.ok, true, 'the fixture requires the seeding commit to land on the ledger ref')
    })

    withDisposableCwd((disposableCwd) => {
      const baselineRepoFiles = filesUnder(repo)

      const rt = runtimeWithPluginData(join(disposableCwd, PLUGIN_DATA_DIR_NAME))
      const opened = openStore(rt, repo)

      assert.equal(
        opened.ok,
        true,
        'openStore must succeed with an absolute CLAUDE_PLUGIN_DATA root outside the project and materialise successfully, never fail because it tried to write into the host project'
      )
      if (!opened.ok) return

      assert.equal(
        opened.value.readThreads().length,
        SEEDED_RECORD_COUNT,
        `expected all ${SEEDED_RECORD_COUNT} seeded threads to be readable through the store opened with a relative CLAUDE_PLUGIN_DATA`
      )

      const newRepoFiles = filesUnder(repo).filter((name) => !baselineRepoFiles.includes(name))
      assert.deepEqual(
        newRepoFiles,
        [],
        `materialising with an absolute CLAUDE_PLUGIN_DATA root outside the project must never write into the project's own working tree; found new file(s) under the repository: ${newRepoFiles.join(', ')}`
      )
    })
  })
})
