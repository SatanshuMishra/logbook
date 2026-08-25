import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { openStore } from '../../src/store/records.ts'
import type { Slot, Thread } from '../../src/store/records.ts'
import { writeRecords, type RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const RECORDS_MODULE = path.join(SRC_ROOT, 'store', 'records.ts')

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logbook-concurrency-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const layoutIn = (rt: Runtime, repo: string): StoreLayout => {
  const result = layoutFor(rt, repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
  return result.value
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

const expectLoaded = (slot: Slot<Thread> | null, label: string): Thread => {
  assert.ok(slot !== null, `${label}: expected a resolvable record, found none`)
  if (slot === null) throw new Error('unreachable')
  assert.equal(slot.quarantined, false, `${label}: expected a clean record, found a quarantine`)
  if (slot.quarantined) throw new Error('unreachable')
  return slot.record
}

const buildReaderScript = (recordsModule: string): string => `
import { spawnSync } from 'node:child_process'
import { openStore } from ${JSON.stringify(recordsModule)}

const payload = JSON.parse(process.argv[2])
const { repo, pluginData, baseRef, ledgerRef, threadRemoteRecord, t0Id, t1Id } = payload

const runGit = (args, opts) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...opts })

const readTree = runGit(['read-tree', baseRef])
if (readTree.status !== 0) {
  process.stderr.write('reader: read-tree failed: ' + readTree.stderr + '\\n')
  process.exit(1)
}

const hash = runGit(['hash-object', '-w', '--stdin'], { input: JSON.stringify(threadRemoteRecord) })
if (hash.status !== 0) {
  process.stderr.write('reader: hash-object failed: ' + hash.stderr + '\\n')
  process.exit(1)
}
const blob = hash.stdout.trim()

const relPath = 'threads/' + threadRemoteRecord.id + '.json'
const addEntry = runGit(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + relPath])
if (addEntry.status !== 0) {
  process.stderr.write('reader: update-index failed: ' + addEntry.stderr + '\\n')
  process.exit(1)
}

const writeTree = runGit(['write-tree'])
if (writeTree.status !== 0) {
  process.stderr.write('reader: write-tree failed: ' + writeTree.stderr + '\\n')
  process.exit(1)
}
const tree = writeTree.stdout.trim()

const commit = runGit(['commit-tree', tree, '-p', baseRef, '-m', 'remote: an independent actor lands a new record'])
if (commit.status !== 0) {
  process.stderr.write('reader: commit-tree failed: ' + commit.stderr + '\\n')
  process.exit(1)
}
const remoteSha = commit.stdout.trim()

const updateRef = runGit(['update-ref', ledgerRef, remoteSha, baseRef])
if (updateRef.status !== 0) {
  process.stderr.write('reader: update-ref failed: ' + updateRef.stderr + '\\n')
  process.exit(1)
}

const rt = {
  now: () => new Date().toISOString(),
  ulid: () => { throw new Error('reader must not mint identifiers') },
  env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData },
  cwd: repo,
  log: () => {}
}

const opened = openStore(rt, repo)
if (!opened.ok) {
  process.stderr.write('reader: open-store-failed: ' + opened.message + '\\n')
  process.exit(1)
}

const result = {
  remoteRef: remoteSha,
  t0: opened.value.readThread(t0Id),
  t1: opened.value.readThread(t1Id),
  tRemote: opened.value.readThread(threadRemoteRecord.id)
}
process.stdout.write(JSON.stringify(result))
`

type ReaderResult = {
  remoteRef: string
  t0: Slot<Thread> | null
  t1: Slot<Thread> | null
  tRemote: Slot<Thread> | null
}

test('concurrent.second-process-destroys-nothing', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)

      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return

      const threadZero = makeThread(rt, 'seed-thread')
      const seedCommit = seeded.value.commit([threadZero], 'A: seed thread zero')
      assert.equal(seedCommit.ok, true)
      if (!seedCommit.ok) return
      const baseRef = seedCommit.after

      const layout = layoutIn(rt, repo)
      const threadRemote = makeThread(rt, 'remote-thread')
      const threadInFlight = makeThread(rt, 'in-flight-thread')

      const scriptDir = mkdtempSync(path.join(tmpdir(), 'logbook-concurrency-reader-'))
      const scriptPath = path.join(scriptDir, 'reader.mjs')
      writeFileSync(scriptPath, buildReaderScript(RECORDS_MODULE), 'utf8')

      const payload = JSON.stringify({
        repo,
        pluginData,
        baseRef,
        ledgerRef: LEDGER_REF,
        threadRemoteRecord: threadRemote.record,
        t0Id: threadZero.record.id,
        t1Id: threadInFlight.record.id
      })

      let readerResult: ReaderResult | null = null
      let readerExitCode: number | null = null
      let readerStderr = ''

      const beforeCas = (): void => {
        const spawned = spawnSync(process.execPath, [scriptPath, payload], { encoding: 'utf8', timeout: 15000 })
        readerExitCode = spawned.status
        readerStderr = spawned.stderr
        if (spawned.status === 0) {
          readerResult = JSON.parse(spawned.stdout) as ReaderResult
        }
      }

      try {
        const writeResult = writeRecords(rt, layout, [threadInFlight], 'A: record in-flight thread', { beforeCas })

        assert.equal(readerExitCode, 0, `the second process failed: ${readerStderr}`)
        assert.ok(readerResult !== null, 'the second process produced no result')
        if (readerResult === null) return
        const outcome: ReaderResult = readerResult
        const remoteRef = outcome.remoteRef

        const seenT0 = expectLoaded(outcome.t0, 'process B reading the pre-existing record')
        assert.deepEqual(seenT0, threadZero.record)

        const seenRemote = expectLoaded(outcome.tRemote, 'process B reading the independently landed record')
        assert.deepEqual(seenRemote, threadRemote.record)

        assert.equal(
          outcome.t1,
          null,
          'process B must see a consistent store: no trace of process A’s uncommitted record'
        )

        assert.equal(writeResult.ok, true, "process A's commit must survive process B opening the store mid-write")
        if (!writeResult.ok) return
        assert.equal(writeResult.before, remoteRef)

        const reopened = openStore(rt, repo)
        assert.equal(reopened.ok, true)
        if (!reopened.ok) return
        const finalThread = expectLoaded(
          reopened.value.readThread(threadInFlight.record.id),
          "process A's own record, read back after it committed"
        )
        assert.deepEqual(finalThread, threadInFlight.record)
      } finally {
        rmSync(scriptDir, { recursive: true, force: true })
      }
    })
  })
})

test('concurrent.same-record-loser-refuses-rather-than-overwrites', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)

      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return

      const contested = makeThread(rt, 'contested-thread')
      const seedCommit = seeded.value.commit([contested], 'seed the contested thread')
      assert.equal(seedCommit.ok, true)
      if (!seedCommit.ok) return

      const layout = layoutIn(rt, repo)
      const base = expectLoaded(seeded.value.readThread(contested.record.id), 'the seeded contested record')

      const writerA: RecordChange = {
        kind: 'thread',
        record: { ...base, spine: { ...base.spine, next_step: 'A wrote this next step' }, updated_at: rt.now() }
      }
      const writerB: RecordChange = {
        kind: 'thread',
        record: { ...base, spine: { ...base.spine, active_goal: 'B wrote this active goal' }, updated_at: rt.now() }
      }

      let writerBLanded = false
      const beforeCas = (): void => {
        if (writerBLanded) return
        const landed = writeRecords(rt, layout, [writerB], 'B: change the active goal')
        assert.equal(landed.ok, true, "the winning writer's commit must land before the losing writer retries")
        writerBLanded = landed.ok
      }

      const writerAResult = writeRecords(rt, layout, [writerA], 'A: change the next step', { beforeCas })

      assert.equal(writerBLanded, true, 'the fixture requires the winning writer to have committed')

      assert.equal(
        writerAResult.ok,
        false,
        'the writer that lost the race must be refused, never told it succeeded over a record it did not read'
      )
      if (writerAResult.ok) return
      assert.equal(writerAResult.reason, 'ref-moved')
      assert.ok(writerAResult.detail.length > 0, 'the refusal must say why the write was refused')

      const committed = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:threads/${contested.record.id}.json`])
      assert.equal(committed.ok, true)
      if (!committed.ok) return
      const survivor = JSON.parse(committed.stdout) as Thread

      assert.equal(
        survivor.spine.active_goal,
        'B wrote this active goal',
        "the winning writer's committed field must survive the losing writer's retry"
      )
      assert.equal(
        survivor.spine.next_step,
        base.spine.next_step,
        'the refused writer must not have laid its stale record over the winner'
      )

      const reopened = openStore(rt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) return
      const readBack = expectLoaded(
        reopened.value.readThread(contested.record.id),
        'the contested record read back through the store'
      )
      assert.deepEqual(readBack, survivor, 'the store must read back exactly the record the ledger ref holds')
    })
  })
})

