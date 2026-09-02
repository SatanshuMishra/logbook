import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { git, GIT_BUFFER_MAX_BYTES } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { openStore } from '../../src/store/records.ts'
import type { Slot, Thread } from '../../src/store/records.ts'
import { writeRecords, type CommitResult, type RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const RECORDS_MODULE = path.join(SRC_ROOT, 'store', 'records.ts')

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const home = mkdtempSync(path.join(tmpdir(), 'logbook-concurrency-plugin-data-'))
  const dir = path.join(home, 'plugin-data')
  mkdirSync(dir)
  try {
    return fn(dir)
  } finally {
    rmSync(home, { recursive: true, force: true })
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

const resolveRealGit = (): string => {
  const located = spawnSync('which', ['git'], { encoding: 'utf8' })
  const resolved = located.status === 0 ? located.stdout.trim() : ''
  if (resolved.length === 0) {
    throw new Error('the git-shim fixture could not locate a real git binary via `which git`')
  }
  return resolved
}

const buildWinnerScript = (scratchDir: string): string => {
  const scriptPath = path.join(scratchDir, 'winner.mjs')
  writeFileSync(
    scriptPath,
    `
import { openStore } from ${JSON.stringify(RECORDS_MODULE)}

const payload = JSON.parse(process.argv[2])
const { repo, pluginData, home, change, message } = payload

const rt = {
  now: () => new Date().toISOString(),
  ulid: () => { throw new Error('winner must not mint identifiers') },
  env: { HOME: home, CLAUDE_PLUGIN_DATA: pluginData },
  cwd: repo,
  log: () => {}
}

const opened = openStore(rt, repo)
if (!opened.ok) {
  process.stdout.write(JSON.stringify({ ok: false, stage: 'open-store', detail: opened.message }))
  process.exit(1)
}

const result = opened.value.commit([change], message)
process.stdout.write(JSON.stringify(result))
`,
    'utf8'
  )
  return scriptPath
}

type GitShim = {
  dir: string
  winnerOutFile: string
  cleanup: () => void
}

type BuildGitShimParams = {
  targetRef: string
  winnerScriptPath: string
  winnerPayload: unknown
}

const buildGitShim = (params: BuildGitShimParams): GitShim => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logbook-concurrency-shim-'))
  const shimPath = path.join(dir, 'git')
  const marker = path.join(dir, 'fired')
  const winnerOutFile = path.join(dir, 'winner-out.json')
  const realGit = resolveRealGit()
  const winnerPayloadJson = JSON.stringify(params.winnerPayload)

  const source = `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')

const MARKER = ${JSON.stringify(marker)}
const TARGET_REF = ${JSON.stringify(params.targetRef)}
const REAL_GIT = ${JSON.stringify(realGit)}
const WINNER_SCRIPT = ${JSON.stringify(params.winnerScriptPath)}
const WINNER_PAYLOAD = ${JSON.stringify(winnerPayloadJson)}
const WINNER_OUT = ${JSON.stringify(winnerOutFile)}

const args = process.argv.slice(2)
const isCasCall = args.includes('update-ref') && args.includes(TARGET_REF)

if (isCasCall && !existsSync(MARKER)) {
  writeFileSync(MARKER, '')
  const winner = spawnSync(process.execPath, [WINNER_SCRIPT, WINNER_PAYLOAD])
  writeFileSync(
    WINNER_OUT,
    JSON.stringify({
      status: winner.status,
      stdout: winner.stdout ? winner.stdout.toString('utf8') : '',
      stderr: winner.stderr ? winner.stderr.toString('utf8') : ''
    })
  )
}

const stdin = readFileSync(0)
const delegated = spawnSync(REAL_GIT, args, { input: stdin })
if (delegated.stdout) process.stdout.write(delegated.stdout)
if (delegated.stderr) process.stderr.write(delegated.stderr)
process.exit(delegated.status === null || delegated.status === undefined ? 1 : delegated.status)
`

  writeFileSync(shimPath, source, { mode: 0o755 })
  chmodSync(shimPath, 0o755)

  return {
    dir,
    winnerOutFile,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

const listTreePaths = (rt: Runtime, repo: string, ref: string): string[] => {
  const result = git(rt, repo, ['ls-tree', '-r', '--name-only', ref])
  assert.equal(result.ok, true, `git ls-tree failed while enumerating the tree at ${ref}`)
  if (!result.ok) throw new Error('unreachable')
  return result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .sort()
}

const listRecordPaths = (root: string): string[] => {
  const walk = (dir: string, prefix: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const relPath = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? walk(path.join(dir, entry.name), relPath) : [relPath]
    })
  return walk(root, '').sort()
}

type WinnerSubprocessOutcome = { status: number | null; stdout: string; stderr: string }

const readWinnerOutcome = (shim: GitShim): CommitResult => {
  assert.ok(
    existsSync(shim.winnerOutFile),
    'the git-shim never intercepted a compare-and-swap on the ledger ref, so the competing writer never ran; ' +
      "the shim fires on args.includes('update-ref') && args.includes(TARGET_REF), matching casUpdateRef's argv " +
      'shape at src/store/ref.ts:23 — that shape has probably changed (for example to the batch form ' +
      "'update-ref --stdin')"
  )
  const raw = readFileSync(shim.winnerOutFile, 'utf8')
  const outcome = JSON.parse(raw) as WinnerSubprocessOutcome
  assert.equal(outcome.status, 0, `the winning writer's subprocess failed: ${outcome.stderr}`)
  return JSON.parse(outcome.stdout) as CommitResult
}

const raceThroughStoreCommit = (
  pluginData: string,
  repo: string,
  loser: RecordChange,
  loserMessage: string,
  winner: RecordChange,
  winnerMessage: string
): { loserResult: CommitResult; winnerResult: CommitResult } => {
  const scratchDir = mkdtempSync(path.join(tmpdir(), 'logbook-concurrency-race-'))
  try {
    const winnerScriptPath = buildWinnerScript(scratchDir)
    const shim = buildGitShim({
      targetRef: LEDGER_REF,
      winnerScriptPath,
      winnerPayload: {
        repo,
        pluginData,
        home: process.env.HOME,
        change: winner,
        message: winnerMessage
      }
    })

    try {
      const raceRt = testRuntime({
        env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData, PATH: shim.dir }
      })

      const opened = openStore(raceRt, repo)
      assert.equal(opened.ok, true, 'the racing writer must be able to open the store')
      if (!opened.ok) throw new Error('unreachable')

      const loserResult = opened.value.commit([loser], loserMessage)
      const winnerResult = readWinnerOutcome(shim)

      return { loserResult, winnerResult }
    } finally {
      shim.cleanup()
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

type FullTreeShimParams = {
  winnerScriptPath: string
  winnerPayload: unknown
}

const FULL_TREE_WINNER_TIMEOUT_MS = 15000

const buildFullTreeGitShim = (params: FullTreeShimParams): GitShim => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logbook-concurrency-fulltree-shim-'))
  const shimPath = path.join(dir, 'git')
  const marker = path.join(dir, 'fired')
  const winnerOutFile = path.join(dir, 'winner-out.json')
  const realGit = resolveRealGit()
  const winnerPayloadJson = JSON.stringify(params.winnerPayload)

  const source = `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')

const MARKER = ${JSON.stringify(marker)}
const REAL_GIT = ${JSON.stringify(realGit)}
const WINNER_SCRIPT = ${JSON.stringify(params.winnerScriptPath)}
const WINNER_PAYLOAD = ${JSON.stringify(winnerPayloadJson)}
const WINNER_OUT = ${JSON.stringify(winnerOutFile)}
const MAX_BUFFER = ${JSON.stringify(GIT_BUFFER_MAX_BYTES)}
const WINNER_TIMEOUT_MS = ${JSON.stringify(FULL_TREE_WINNER_TIMEOUT_MS)}

const args = process.argv.slice(2)
const isFullTreeCall = args.includes('--full-tree')

if (isFullTreeCall && !existsSync(MARKER)) {
  writeFileSync(MARKER, '')
  const winner = spawnSync(process.execPath, [WINNER_SCRIPT, WINNER_PAYLOAD], { timeout: WINNER_TIMEOUT_MS })
  writeFileSync(
    WINNER_OUT,
    JSON.stringify({
      status: winner.status,
      stdout: winner.stdout ? winner.stdout.toString('utf8') : '',
      stderr: winner.stderr ? winner.stderr.toString('utf8') : '',
      error: winner.error ? String(winner.error.message || winner.error) : null
    })
  )
}

const stdin = readFileSync(0)
const delegated = spawnSync(REAL_GIT, args, { input: stdin, maxBuffer: MAX_BUFFER })
if (delegated.stdout) process.stdout.write(delegated.stdout)
if (delegated.stderr) process.stderr.write(delegated.stderr)
process.exit(delegated.status === null || delegated.status === undefined ? 1 : delegated.status)
`

  writeFileSync(shimPath, source, { mode: 0o755 })
  chmodSync(shimPath, 0o755)

  return {
    dir,
    winnerOutFile,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

type FullTreeWinnerSubprocessOutcome = { status: number | null; stdout: string; stderr: string; error: string | null }

const readFullTreeWinnerOutcome = (shim: GitShim): CommitResult => {
  assert.ok(
    existsSync(shim.winnerOutFile),
    'the git-shim never intercepted a materialisation tree listing, so the competing writer never ran; ' +
      "the shim fires on args.includes('--full-tree'), matching materialiseTreeInto's ls-tree invocation " +
      'at src/store/materialise-tree.ts:159 — that shape has probably changed'
  )
  const raw = readFileSync(shim.winnerOutFile, 'utf8')
  const outcome = JSON.parse(raw) as FullTreeWinnerSubprocessOutcome
  assert.notEqual(
    outcome.status,
    null,
    `the winning writer's subprocess did not complete within ${FULL_TREE_WINNER_TIMEOUT_MS}ms and was terminated: ${outcome.error ?? 'no spawn error reported'}`
  )
  assert.equal(
    outcome.status,
    0,
    `the winning writer's subprocess failed: ${outcome.stderr}${outcome.error ? ` (spawn error: ${outcome.error})` : ''}`
  )
  return JSON.parse(outcome.stdout) as CommitResult
}

test('concurrent.a-record-that-landed-during-materialisation-survives', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)

      const seeded = openStore(rt, repo)
      assert.equal(seeded.ok, true)
      if (!seeded.ok) return

      const seedThread = makeThread(rt, 'seed-thread')
      const seedCommit = seeded.value.commit([seedThread], 'seed thread zero')
      assert.equal(seedCommit.ok, true)
      if (!seedCommit.ok) return

      const layout = layoutIn(rt, repo)
      rmSync(path.join(layout.state, 'last-materialised'), { force: true })

      const landedThread = makeThread(rt, 'landed-thread')
      const victimThread = makeThread(rt, 'victim-thread')

      const scratchDir = mkdtempSync(path.join(tmpdir(), 'logbook-concurrency-fulltree-race-'))
      try {
        const winnerScriptPath = buildWinnerScript(scratchDir)
        const shim = buildFullTreeGitShim({
          winnerScriptPath,
          winnerPayload: {
            repo,
            pluginData,
            home: process.env.HOME,
            change: landedThread,
            message: 'land a record mid-materialisation'
          }
        })

        try {
          const raceRt = testRuntime({
            env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData, PATH: shim.dir }
          })

          const opened = openStore(raceRt, repo)
          assert.equal(opened.ok, true, 'the racing opener must be able to open the store')
          if (!opened.ok) return

          const winnerOutcome = readFullTreeWinnerOutcome(shim)
          assert.equal(
            winnerOutcome.ok,
            true,
            'the competing writer must land its record before materialisation completes'
          )

          const victimResult = opened.value.commit([victimThread], 'commit after the hole opened')
          assert.equal(victimResult.ok, true, "the victim's own commit must succeed")
        } finally {
          shim.cleanup()
        }
      } finally {
        rmSync(scratchDir, { recursive: true, force: true })
      }

      const cleanRt = runtimeWithHome(pluginData)
      const reopened = openStore(cleanRt, repo)
      assert.equal(reopened.ok, true)
      if (!reopened.ok) return

      const survivor = expectLoaded(
        reopened.value.readThread(landedThread.record.id),
        'the record that landed during materialisation'
      )
      assert.deepEqual(survivor, landedThread.record)

      assert.deepEqual(listRecordPaths(layout.records), listTreePaths(cleanRt, repo, LEDGER_REF))
    })
  })
})

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

      const base = expectLoaded(seeded.value.readThread(contested.record.id), 'the seeded contested record')

      const writerA: RecordChange = {
        kind: 'thread',
        record: { ...base, spine: { ...base.spine, next_step: 'A wrote this next step' }, updated_at: rt.now() }
      }
      const writerB: RecordChange = {
        kind: 'thread',
        record: { ...base, spine: { ...base.spine, active_goal: 'B wrote this active goal' }, updated_at: rt.now() }
      }

      const { loserResult: writerAResult, winnerResult } = raceThroughStoreCommit(
        pluginData,
        repo,
        writerA,
        'A: change the next step',
        writerB,
        'B: change the active goal'
      )

      assert.equal(winnerResult.ok, true, "the winning writer's commit must land before the losing writer retries")

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

test('concurrent.same-record-disk-diverges-from-ref-after-loser-rollback', () => {
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

      const { loserResult: writerAResult, winnerResult } = raceThroughStoreCommit(
        pluginData,
        repo,
        writerA,
        'A: change the next step',
        writerB,
        'B: change the active goal'
      )

      assert.equal(winnerResult.ok, true, "the winning writer's commit must have landed")
      assert.equal(
        writerAResult.ok,
        false,
        'the writer that lost the race must be refused, never told it succeeded over a record it did not read'
      )

      const refContent = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:threads/${contested.record.id}.json`])
      assert.equal(refContent.ok, true)
      if (!refContent.ok) return

      const diskPath = path.join(layout.records, 'threads', `${contested.record.id}.json`)
      const diskContent = readFileSync(diskPath, 'utf8')

      assert.equal(
        diskContent,
        refContent.stdout,
        'the readable copy on disk must equal the ledger ref tree it claims to be materialised from, even after a losing writer rolled back'
      )

      const refPaths = listTreePaths(rt, repo, LEDGER_REF)
      const diskPaths = listRecordPaths(layout.records)

      assert.deepEqual(
        diskPaths,
        refPaths,
        'the readable copy on disk must hold exactly the same set of record paths as the ledger ref tree; ' +
          'a path present in one and absent from the other means a record was lost or left orphaned on disk ' +
          'while the ref moved on without it'
      )

      for (const relPath of refPaths) {
        const shared = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:${relPath}`])
        assert.equal(shared.ok, true, `git cat-file failed reading ${relPath} from the ledger ref`)
        if (!shared.ok) continue
        const sharedDiskContent = readFileSync(path.join(layout.records, relPath), 'utf8')
        assert.equal(
          sharedDiskContent,
          shared.stdout,
          `the on-disk bytes for ${relPath} must equal the ledger ref's copy of that record`
        )
      }
    })
  })
})

