import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { sync } from '../../src/merge/sync.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Teammate } from '../support/clone-fixture.ts'
import { withTwoClones } from '../support/clone-fixture.ts'

const layoutIn = (teammate: Teammate): StoreLayout => {
  const result = layoutFor(teammate.rt, teammate.repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
  return result.value
}

const makeThread = (rt: Runtime, slug: string): RecordChange => ({
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

const threadIsReachable = (rt: Runtime, repo: string, id: string): boolean =>
  git(rt, repo, ['cat-file', '-e', `${LEDGER_REF}:threads/${id}.json`]).ok

test('sync.cas-retry', () => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const threadA = makeThread(ana.rt, 'thread-a')
    const createA = ana.store.commit([threadA], 'ana: create thread a')
    assert.equal(createA.ok, true)

    const pushA = sync(ana.rt, ana.store, anaLayout)
    assert.equal(pushA.ok, true)
    if (!pushA.ok) return
    assert.equal(pushA.action, 'pushed')

    const fastForwardBen = sync(ben.rt, ben.store, benLayout)
    assert.equal(fastForwardBen.ok, true)
    if (!fastForwardBen.ok) return
    assert.equal(fastForwardBen.action, 'fast-forwarded')

    const threadC = makeThread(ben.rt, 'thread-c')
    const createC = ben.store.commit([threadC], 'ben: create thread c')
    assert.equal(createC.ok, true)

    const pushC = sync(ben.rt, ben.store, benLayout)
    assert.equal(pushC.ok, true)
    if (!pushC.ok) return
    assert.equal(pushC.action, 'pushed')

    const threadB = makeThread(ana.rt, 'thread-b')
    const createB = ana.store.commit([threadB], 'ana: create thread b')
    assert.equal(createB.ok, true)

    const beforeRaceRef = git(ana.rt, ana.repo, ['rev-parse', LEDGER_REF])
    assert.equal(beforeRaceRef.ok, true)
    if (!beforeRaceRef.ok) return
    const beforeRace = beforeRaceRef.stdout.trim()

    const threadDId = ana.rt.ulid()
    const threadDContent = JSON.stringify({
      id: threadDId,
      slug: 'thread-d',
      title: 'thread thread-d',
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
      created_at: ana.rt.now(),
      updated_at: ana.rt.now()
    })

    const coordDir = mkdtempSync(join(tmpdir(), 'logbook-sync-coord-'))
    const goFile = join(coordDir, 'go')
    const doneFile = join(coordDir, 'done')
    const recordPath = `threads/${threadDId}.json`

    const childScript = `
      const { spawnSync } = require('node:child_process');
      const fs = require('node:fs');
      const repo = ${JSON.stringify(ana.repo)};
      const goFile = ${JSON.stringify(goFile)};
      const doneFile = ${JSON.stringify(doneFile)};
      const recordPath = ${JSON.stringify(recordPath)};
      const beforeRace = ${JSON.stringify(beforeRace)};
      const content = ${JSON.stringify(threadDContent)};
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(goFile)) {
        if (Date.now() > deadline) { process.exit(1); }
      }
      const runGit = (args, opts) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...opts });
      runGit(['read-tree', beforeRace]);
      const hash = runGit(['hash-object', '-w', '--stdin'], { input: content });
      const blob = hash.stdout.trim();
      runGit(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + recordPath]);
      const writeTree = runGit(['write-tree']);
      const tree = writeTree.stdout.trim();
      const commit = runGit(['commit-tree', tree, '-p', beforeRace, '-m', 'child races the local ledger ref']);
      const sha = commit.stdout.trim();
      runGit(['update-ref', 'refs/logbook/ledger', sha, beforeRace]);
      fs.writeFileSync(doneFile, '');
    `

    const child = spawn(process.execPath, ['-e', childScript], { stdio: 'ignore' })

    let ledgerRevParseCount = 0
    const countingGit: typeof git = (callRt, callRepo, args, opts) => {
      if (args[0] === 'rev-parse' && args[1] === LEDGER_REF) {
        ledgerRevParseCount += 1
      }
      return git(callRt, callRepo, args, opts)
    }

    const beforeCas = (): void => {
      writeFileSync(goFile, '')
      const deadline = Date.now() + 5000
      while (!existsSync(doneFile)) {
        if (Date.now() > deadline) {
          throw new Error('timed out waiting for the racing process to move the ledger ref')
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
      }
    }

    try {
      const mergeResult = sync(ana.rt, ana.store, anaLayout, { git: countingGit, beforeCas })

      assert.equal(mergeResult.ok, true)
      if (!mergeResult.ok) return
      assert.equal(mergeResult.action, 'merged')

      assert.equal(ledgerRevParseCount, 3)

      assert.equal(threadIsReachable(ana.rt, ana.repo, threadA.record.id), true)
      assert.equal(threadIsReachable(ana.rt, ana.repo, threadB.record.id), true)
      assert.equal(threadIsReachable(ana.rt, ana.repo, threadC.record.id), true)
      assert.equal(threadIsReachable(ana.rt, ana.repo, threadDId), true)

      assert.equal(threadIsReachable(ben.rt, remote, threadA.record.id), true)
      assert.equal(threadIsReachable(ben.rt, remote, threadB.record.id), true)
      assert.equal(threadIsReachable(ben.rt, remote, threadC.record.id), true)
      assert.equal(threadIsReachable(ben.rt, remote, threadDId), true)
    } finally {
      child.kill()
      rmSync(coordDir, { recursive: true, force: true })
    }
  })
})
