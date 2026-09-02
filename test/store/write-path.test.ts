import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { git } from '../../src/store/git.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { writeIndexScratchDir, writeRecords, type RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const STORE_SRC_DIR = new URL('../../src/store/', import.meta.url).pathname

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const layoutIn = (rt: Runtime, repo: string): StoreLayout => {
  const result = layoutFor(rt, repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
  return result.value
}

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

const sharedIndexSnapshot = (layout: StoreLayout): Set<string> => {
  try {
    return new Set(readdirSync(writeIndexScratchDir(layout)).filter((name) => name.startsWith('logbook-write-index-')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

const newSharedIndexFiles = (layout: StoreLayout, before: Set<string>): string[] =>
  [...sharedIndexSnapshot(layout)].filter((name) => !before.has(name))

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

test('write.builds-tree-from-previous', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const first = makeThread(rt, 'first-thread')
      const firstResult = writeRecords(rt, layout, [first], 'record first thread')
      assert.equal(firstResult.ok, true)
      if (!firstResult.ok) return
      assert.equal(firstResult.before, null)

      const second = makeThread(rt, 'second-thread')
      const secondResult = writeRecords(rt, layout, [second], 'record second thread')
      assert.equal(secondResult.ok, true)
      if (!secondResult.ok) return
      assert.equal(secondResult.before, firstResult.after)

      const listing = git(rt, repo, ['ls-tree', '-r', '--name-only', LEDGER_REF])
      assert.equal(listing.ok, true)
      if (!listing.ok) return
      const paths = listing.stdout.trim().split('\n')
      assert.ok(paths.includes(`threads/${first.record.id}.json`))
      assert.ok(paths.includes(`threads/${second.record.id}.json`))

      const firstBlob = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:threads/${first.record.id}.json`])
      assert.equal(firstBlob.ok, true)
      if (firstBlob.ok) {
        assert.deepEqual(JSON.parse(firstBlob.stdout), first.record)
      }
    })
  })
})

test('write.retries-on-moved-ref', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const coordDir = mkdtempSync(join(tmpdir(), 'logbook-coord-'))
      const goFile = join(coordDir, 'go')
      const doneFile = join(coordDir, 'done')

      const childRecordPath = 'threads/child-thread.json'
      const childScript = `
        const { spawnSync } = require('node:child_process');
        const fs = require('node:fs');
        const repo = ${JSON.stringify(repo)};
        const goFile = ${JSON.stringify(goFile)};
        const doneFile = ${JSON.stringify(doneFile)};
        const recordPath = ${JSON.stringify(childRecordPath)};
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(goFile)) {
          if (Date.now() > deadline) { process.exit(1); }
        }
        const runGit = (args, opts) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...opts });
        const hash = runGit(['hash-object', '-w', '--stdin'], { input: 'child record content' });
        const blob = hash.stdout.trim();
        runGit(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + recordPath]);
        const writeTree = runGit(['write-tree']);
        const tree = writeTree.stdout.trim();
        const commit = runGit(['commit-tree', tree, '-m', 'child commit']);
        const sha = commit.stdout.trim();
        runGit(['update-ref', 'refs/logbook/ledger', sha, '']);
        fs.writeFileSync(doneFile, '');
      `

      const child = spawn(process.execPath, ['-e', childScript], { stdio: 'ignore' })

      try {
        const beforeCas = (): void => {
          writeFileSync(goFile, '')
          const deadline = Date.now() + 5000
          while (!existsSync(doneFile)) {
            if (Date.now() > deadline) {
              throw new Error('timed out waiting for the second process to move the ref')
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
          }
        }

        const parentChange = makeThread(rt, 'parent-thread')
        const result = writeRecords(rt, layout, [parentChange], 'record parent thread', { beforeCas })

        assert.equal(result.ok, true)
        if (!result.ok) return

        const parentBlob = git(
          rt,
          repo,
          ['cat-file', '-p', `${LEDGER_REF}:threads/${parentChange.record.id}.json`]
        )
        assert.equal(parentBlob.ok, true)

        const childBlob = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:${childRecordPath}`])
        assert.equal(childBlob.ok, true)
        if (childBlob.ok) {
          assert.equal(childBlob.stdout, 'child record content')
        }
      } finally {
        child.kill()
        rmSync(coordDir, { recursive: true, force: true })
      }
    })
  })
})

test('write.no-orphan-record', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const failingGit: typeof git = (callRt, callRepo, args, opts) => {
        if (args[0] === 'commit-tree') {
          return { ok: false, code: 1, stderr: 'injected commit-tree failure' }
        }
        return git(callRt, callRepo, args, opts)
      }

      const change = makeThread(rt, 'orphan-candidate')
      const result = writeRecords(rt, layout, [change], 'should fail', { git: failingGit })

      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.reason, 'io')

      const threadsDir = join(layout.records, 'threads')
      const remaining = existsSync(threadsDir) ? readdirSync(threadsDir) : []
      assert.deepEqual(remaining, [])
    })
  })
})

test('write.leaves-no-temporary-index-on-success', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)
      const before = sharedIndexSnapshot(layout)

      const change = makeThread(rt, 'index-cleanup-success')
      const result = writeRecords(rt, layout, [change], 'record with cleanup check')
      assert.equal(result.ok, true)

      assert.deepEqual(newSharedIndexFiles(layout, before), [])
    })
  })
})

test('write.leaves-no-temporary-index-on-failure', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)
      const before = sharedIndexSnapshot(layout)

      const failingGit: typeof git = (callRt, callRepo, args, opts) => {
        if (args[0] === 'write-tree') {
          return { ok: false, code: 1, stderr: 'injected write-tree failure' }
        }
        return git(callRt, callRepo, args, opts)
      }

      const change = makeThread(rt, 'index-cleanup-failure')
      const result = writeRecords(rt, layout, [change], 'should fail', { git: failingGit })
      assert.equal(result.ok, false)

      assert.deepEqual(newSharedIndexFiles(layout, before), [])
    })
  })
})

test('write.index-census-ignores-a-concurrent-writers-in-flight-file', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)
      const before = sharedIndexSnapshot(layout)

      const decoyPath = join(tmpdir(), `logbook-write-index-${randomUUID()}`)
      writeFileSync(decoyPath, '')

      try {
        const change = makeThread(rt, 'index-census-decoy')
        const result = writeRecords(rt, layout, [change], 'record while a decoy file is in flight elsewhere')
        assert.equal(result.ok, true)

        assert.deepEqual(newSharedIndexFiles(layout, before), [])
      } finally {
        rmSync(decoyPath, { force: true })
      }
    })
  })
})

test('worktree.absent', () => {
  const sourceFiles = readdirSync(STORE_SRC_DIR).filter((name) => name.endsWith('.ts'))
  for (const name of sourceFiles) {
    const contents = readFileSync(join(STORE_SRC_DIR, name), 'utf8')
    assert.doesNotMatch(contents, /worktree/i, `${name} must not mention a worktree`)
  }

  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = runtimeWithHome(pluginData)
      const layout = layoutIn(rt, repo)

      const before = readdirSync(repo, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()

      const change = makeThread(rt, 'worktree-check')
      const result = writeRecords(rt, layout, [change], 'full write cycle')
      assert.equal(result.ok, true)

      const after = readdirSync(repo, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()

      assert.deepEqual(after, before)
      assert.equal(statSync(repo).isDirectory(), true)
    })
  })
})
