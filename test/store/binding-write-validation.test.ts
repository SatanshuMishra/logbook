import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { BindingRecord, type Binding } from '../../src/schema/binding.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { readAllRecordFiles } from '../../src/store/read-path.ts'
import { openStore } from '../../src/store/records.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-binding-write-validation-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('store.commit-refuses-a-schema-invalid-binding', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const invalidBinding = {
        id: rt.ulid(),
        thread_id: rt.ulid(),
        branch: '',
        created_at: rt.now()
      } as unknown as Binding

      const result = store.commit(
        [{ kind: 'binding', record: invalidBinding }],
        'attempt to commit an invalid binding'
      )

      assert.equal(result.ok, false, 'a schema-invalid binding must be refused by the store, never committed')
      if (result.ok) return
      assert.equal(result.reason, 'invalid')
      assert.match(result.detail, /^branch failed its stored-shape validation:/)
      assert.match(result.detail, /it accepts/)
      assert.match(result.detail, /a valid example is/)
      assert.match(result.detail, /retryable=true/)

      const refListing = git(rt, repo, ['for-each-ref', LEDGER_REF])
      assert.equal(refListing.ok, true)
      if (refListing.ok) {
        assert.equal(refListing.stdout.trim(), '', 'a refused binding must never advance the ledger ref')
      }
    })
  })
})

test('store.commit-accepts-a-valid-binding-and-files-it-at-bindings-slash-id', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const opened = openStore(rt, repo)
      assert.equal(opened.ok, true)
      if (!opened.ok) return
      const store = opened.value

      const validBinding: Binding = {
        id: rt.ulid(),
        thread_id: rt.ulid(),
        branch: 'feat/valid-binding',
        created_at: rt.now()
      }

      const result = store.commit(
        [{ kind: 'binding', record: validBinding }],
        'commit a valid binding'
      )

      assert.equal(result.ok, true, 'a schema-valid binding must be accepted and committed')
      if (!result.ok) return

      const listing = git(rt, repo, ['ls-tree', '-r', '--name-only', LEDGER_REF])
      assert.equal(listing.ok, true)
      if (!listing.ok) return
      const paths = listing.stdout.trim().split('\n')
      assert.deepEqual(paths, [`bindings/${validBinding.id}.json`], 'the committed binding must land at bindings/<id>.json')

      const blob = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:bindings/${validBinding.id}.json`])
      assert.equal(blob.ok, true)
      if (!blob.ok) return
      assert.deepEqual(JSON.parse(blob.stdout), validBinding)

      const layout = layoutFor(rt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return
      const slots = readAllRecordFiles<Binding>(join(layout.value.records, 'bindings'), BindingRecord)
      const readBack = slots.find((slot) => !slot.quarantined && slot.record.id === validBinding.id)
      assert.ok(readBack !== undefined && !readBack.quarantined, 'the committed binding must be readable back through the store')
      if (readBack === undefined || readBack.quarantined) return
      assert.deepEqual(readBack.record, validBinding)
    })
  })
})
