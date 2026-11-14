import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime, Writer } from '../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments, lastWriter, readDocument } from '../../src/thread/store.ts'
import { withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Store = { rt: Runtime; paths: RepoPaths }

const RUN: Writer = { kind: 'command', name: 'run:fix-login' }
const SESSION: Writer = { kind: 'session', name: 's1' }

const withStore = (fn: (store: Store) => void): void =>
  withRepo((repo) => {
    const home = mkdtempSync(join(tmpdir(), 'logbook-last-writer-home-'))
    try {
      const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 's1' })
      const found = findRepository(rt, repo)
      assert.ok(found.ok, 'the test repository must be found')
      fn({ rt, paths: found.value })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

const write = (store: Store, writer: Writer, slug: string, text: string): void => {
  const stored = readDocument(store.rt, store.paths, slug)
  const written = commitDocuments({ ...store.rt, writer }, store.paths, {
    changes: [{ slug, text, expectedBlob: stored?.blob ?? null }],
    message: `update_thread ${slug}: next step`
  })
  assert.ok(written.ok, `the document of ${slug} must be written`)
}

test('last-writer.names-the-run-that-wrote-the-document-last', () => {
  withStore((store) => {
    write(store, SESSION, 'fix-login', 'opened\n')
    write(store, RUN, 'fix-login', 'the drive entered review\n')
    assert.equal(lastWriter(store.rt, store.paths, 'fix-login'), 'run:fix-login')
  })
})

test('last-writer.names-the-session-once-it-writes-after-the-run', () => {
  withStore((store) => {
    write(store, RUN, 'fix-login', 'the drive entered ready-pr\n')
    write(store, SESSION, 'fix-login', 'cleaned up\n')
    assert.equal(lastWriter(store.rt, store.paths, 'fix-login'), 's1')
  })
})

test('last-writer.ignores-a-later-write-to-another-thread', () => {
  withStore((store) => {
    write(store, SESSION, 'fix-login', 'opened\n')
    write(store, { kind: 'command', name: 'run:other-run' }, 'other-run', 'the drive entered build\n')
    assert.equal(lastWriter(store.rt, store.paths, 'fix-login'), 's1')
  })
})

test('last-writer.is-null-for-a-thread-nothing-wrote', () => {
  withStore((store) => {
    assert.equal(lastWriter(store.rt, store.paths, 'fix-login'), null)
    write(store, SESSION, 'other-run', 'opened\n')
    assert.equal(lastWriter(store.rt, store.paths, 'fix-login'), null)
  })
})
