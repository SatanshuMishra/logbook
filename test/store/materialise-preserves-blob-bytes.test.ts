import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { openStore } from '../../src/store/records.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const RECORD_REL_PATH = 'threads/newline-record.json'
const RECORD_CONTENT = '{\n  "line one": "a",\n  "line two": "b"\n}\n'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-blob-bytes-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('store.materialised-bytes-are-identical-to-the-stored-blob-under-autocrlf', () => {
  withRepo((repo) => {
    withPluginData((seedPluginData) => {
      const seedRt = runtimeWithHome(seedPluginData)
      const seeded = openStore(seedRt, repo)
      assert.equal(seeded.ok, true, 'the fixture requires a working store to seed a record with an embedded newline')
      if (!seeded.ok) return

      const committed = seeded.value.commit(
        [{ kind: 'raw', relPath: RECORD_REL_PATH, content: RECORD_CONTENT }],
        'seed one raw record containing a newline'
      )
      assert.equal(committed.ok, true, 'the fixture requires the seeding commit to succeed')

      const autocrlf = git(seedRt, repo, ['config', 'core.autocrlf', 'true'])
      assert.equal(autocrlf.ok, true, 'the fixture requires core.autocrlf=true to be set on the repository')

      const blobSha = git(seedRt, repo, ['rev-parse', `${LEDGER_REF}:${RECORD_REL_PATH}`])
      assert.equal(blobSha.ok, true, 'the fixture requires the seeded record to be resolvable as a blob')
      if (!blobSha.ok) return

      const blobContent = git(seedRt, repo, ['cat-file', '-p', blobSha.stdout.trim()])
      assert.equal(blobContent.ok, true, 'the fixture requires the stored blob to be readable via cat-file')
      if (!blobContent.ok) return
      const expectedBytes = Buffer.from(blobContent.stdout, 'utf8')
      assert.ok(expectedBytes.includes(0x0a), 'the fixture requires the stored blob to contain a raw newline byte')
    })

    withPluginData((freshPluginData) => {
      const freshRt = runtimeWithHome(freshPluginData)
      const reopened = openStore(freshRt, repo)
      assert.equal(
        reopened.ok,
        true,
        'a fresh store must still materialise successfully from a ledger ref written under a different plugin-data root'
      )
      if (!reopened.ok) return

      const layout = layoutFor(freshRt, repo)
      assert.equal(layout.ok, true)
      if (!layout.ok) return

      const blobSha = git(freshRt, repo, ['rev-parse', `${LEDGER_REF}:${RECORD_REL_PATH}`])
      assert.equal(blobSha.ok, true)
      if (!blobSha.ok) return
      const blobContent = git(freshRt, repo, ['cat-file', '-p', blobSha.stdout.trim()])
      assert.equal(blobContent.ok, true)
      if (!blobContent.ok) return
      const expectedBytes = Buffer.from(blobContent.stdout, 'utf8')

      const materialisedPath = join(layout.value.records, RECORD_REL_PATH)
      const materialisedBytes = readFileSync(materialisedPath)

      assert.ok(
        materialisedBytes.equals(expectedBytes),
        `materialised bytes at ${materialisedPath} (length ${materialisedBytes.length}) must be byte-identical to the stored blob (length ${expectedBytes.length}); git's working-tree content conversion must never run during materialisation`
      )
    })
  })
})
