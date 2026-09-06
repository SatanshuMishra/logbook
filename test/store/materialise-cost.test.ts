import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { getMaterialiseCallCounter, resetMaterialiseCallCounter } from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const MATERIALISE_SUBPROCESS_CEILING = 3

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-materialise-cost-'))
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

const materialiseSubprocessesFor = (recordCount: number): number =>
  withRepo((repo) =>
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) throw new Error('expected the seeding open to succeed')

      const changes: RecordChange[] = []
      for (let index = 0; index < recordCount; index += 1) {
        changes.push(makeThread(rt, `materialise-cost-${index}`))
      }
      const committed = seeded.value.commit(changes, `seed ${recordCount} threads`)
      assert.equal(committed.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) throw new Error('expected layoutFor to succeed')

      rmSync(join(layout.value.state, 'last-materialised'), { force: true })
      resetMaterialiseCallCounter()

      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) throw new Error('expected the re-materialising open to succeed')
      assert.equal(reopened.value.readThreads().length, recordCount)

      return getMaterialiseCallCounter()
    })
  )

test('store.materialisation-cost-does-not-grow-with-record-count', () => {
  const few = materialiseSubprocessesFor(4)
  const many = materialiseSubprocessesFor(40)

  assert.equal(
    few,
    many,
    `materialising 4 records cost ${few} subprocesses and 40 records cost ${many}; the cost must not depend on how many records the ledger holds`
  )
  assert.equal(
    many <= MATERIALISE_SUBPROCESS_CEILING,
    true,
    `materialising 40 records cost ${many} subprocesses, above the ceiling of ${MATERIALISE_SUBPROCESS_CEILING}`
  )
})
