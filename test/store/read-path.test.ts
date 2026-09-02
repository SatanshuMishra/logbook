import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor } from '../../src/store/layout.ts'
import {
  getMaterialiseCallCounter,
  getSubprocessCallCounter,
  readRecordFile,
  readRecordVerdict,
  resetMaterialiseCallCounter,
  resetSubprocessCallCounter
} from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-'))
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
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

test('read.quarantines-one-bad-record', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const t1 = makeThread(rt, 'thread-one')
      const t2 = makeThread(rt, 'thread-two')
      const t3 = makeThread(rt, 'thread-three')

      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const commitResult = opened.value.commit([t1, t2, t3], 'seed three threads')
      assert.equal(commitResult.ok, true)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      const badPath = join(layout.value.records, 'threads', `${t2.record.id}.json`)
      writeFileSync(badPath, '{', 'utf8')

      const slots = opened.value.readThreads()
      assert.equal(slots.length, 3)

      const quarantined = slots.filter((slot) => slot.quarantined)
      const loaded = slots.filter((slot) => !slot.quarantined)
      assert.equal(quarantined.length, 1)
      assert.equal(loaded.length, 2)
      assert.equal(quarantined[0]?.path, badPath)
      assert.ok((quarantined[0]?.reason ?? '').length > 0)
    })
  })
})

test('read.is-subprocess-free', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const change = makeThread(rt, 'subprocess-free')

      const seeding = openStore(rt, repo)
      assert.equal(seeding.ok, true)
      if (!seeding.ok) return
      const commitResult = seeding.value.commit([change], 'seed one record')
      assert.equal(commitResult.ok, true)

      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return

      resetSubprocessCallCounter()

      opened.value.readThreads()
      opened.value.readThread(change.record.id)
      opened.value.readDecision('01ARZ3NDEKTSV4RRFFQ69G5FAV')
      opened.value.readSessionEntries(change.record.id)
      opened.value.readSessionEntry(change.record.id, '01ARZ3NDEKTSV4RRFFQ69G5FAV')

      assert.equal(getSubprocessCallCounter(), 0)
    })
  })
})

test('read.refreshes-only-on-ref-move', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const change = makeThread(rt, 'refresh-check')

      const seeding = openStore(rt, repo)
      assert.equal(seeding.ok, true)
      if (!seeding.ok) return
      const commitResult = seeding.value.commit([change], 'seed one record')
      assert.equal(commitResult.ok, true)

      resetMaterialiseCallCounter()

      const secondOpen = openStore(rt, repo)
      assert.equal(secondOpen.ok, true)
      if (!secondOpen.ok) return
      secondOpen.value.readThreads()

      assert.equal(getMaterialiseCallCounter(), 0)
    })
  })
})

test('read.absent-is-null-not-error', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const missing = opened.value.readThread('01ARZ3NDEKTSV4RRFFQ69G5FAV')
      assert.equal(missing, null)
    })
  })

  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const first = openStore(rt, repo)
      assert.equal(first.ok, true)
      if (!first.ok) return

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return

      chmodSync(layout.value.records, 0o000)
      try {
        const second = openStore(rt, repo)
        assert.equal(second.ok, false)
      } finally {
        chmodSync(layout.value.records, 0o755)
      }
    })
  })
})

test('read.verdict-agrees-with-read-record-file', () => {
  withPluginData((pluginData) => {
    const dir = pluginData
    const absentPath = join(dir, 'absent-decision.json')
    const unparseablePath = join(dir, 'unparseable-decision.json')
    const invalidSchemaPath = join(dir, 'invalid-schema-decision.json')

    writeFileSync(unparseablePath, '{not-json', 'utf8')
    writeFileSync(invalidSchemaPath, JSON.stringify({ id: 'not-a-ulid', title: 'x' }), 'utf8')

    const cases: { name: string; path: string }[] = [
      { name: 'absent file', path: absentPath },
      { name: 'unparseable JSON', path: unparseablePath },
      { name: 'well-formed JSON that fails the declared schema', path: invalidSchemaPath }
    ]

    for (const testCase of cases) {
      const slot = readRecordFile<Decision>(testCase.path, DecisionRecord)
      const expectedVerdict = slot === null ? 'absent' : slot.quarantined ? 'quarantined' : 'valid'
      const verdict = readRecordVerdict<Decision>(testCase.path, DecisionRecord)
      assert.equal(verdict, expectedVerdict, `readRecordVerdict must agree with readRecordFile for ${testCase.name}`)
    }

    assert.equal(
      readRecordVerdict<Decision>(invalidSchemaPath, DecisionRecord),
      'quarantined',
      'a decision file that is well-formed JSON but invalid against DecisionRecord must verdict as quarantined, matching readRecordFile, and never as resolved'
    )
  })
})
