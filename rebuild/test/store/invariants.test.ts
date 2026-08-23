import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit, withRepo, withRepoNoIdentity } from '../support/git-fixture.ts'
import { git, readIdentity, type Identity } from '../../src/store/git.ts'
import { LEDGER_REF, casUpdateRef } from '../../src/store/ref.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { writeRecords, type RecordChange } from '../../src/store/write-path.ts'

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-'))
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

test('store.leaves-index-alone', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      writeFileSync(join(repo, 'staged.txt'), 'a developer is mid-edit\n')
      const addStaged = rawGit(repo, ['add', 'staged.txt'])
      assert.equal(addStaged.status, 0)
      const before = rawGit(repo, ['diff', '--cached', '--name-status'])
      assert.equal(before.status, 0)

      const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginData } })
      const layout = layoutIn(rt, repo)

      const change = makeThread(rt, 'first-thread')
      const write = writeRecords(rt, layout, [change], 'record first thread')
      assert.equal(write.ok, true, write.ok ? undefined : write.detail)

      const after = rawGit(repo, ['diff', '--cached', '--name-status'])
      assert.equal(after.status, 0)
      assert.equal(after.stdout, before.stdout)
    })
  })
})

test('store.survives-branch-switch', () => {
  withRepo((repo) => {
    withPluginData((pluginData) => {
      const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginData } })
      const layout = layoutIn(rt, repo)

      const first = makeThread(rt, 'before-switch')
      const firstWrite = writeRecords(rt, layout, [first], 'record before switching')
      assert.equal(firstWrite.ok, true, firstWrite.ok ? undefined : firstWrite.detail)
      if (!firstWrite.ok) return

      assert.equal(rawGit(repo, ['switch', '-c', 'b1']).status, 0)
      assert.equal(rawGit(repo, ['switch', '-c', 'b2']).status, 0)

      const readBack = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:threads/${first.record.id}.json`])
      assert.equal(readBack.ok, true)
      if (readBack.ok) assert.deepEqual(JSON.parse(readBack.stdout), first.record)

      const statusBefore = rawGit(repo, ['status', '--porcelain'])
      assert.equal(statusBefore.status, 0)

      const second = makeThread(rt, 'after-switch')
      const secondWrite = writeRecords(rt, layout, [second], 'record after switching')
      assert.equal(secondWrite.ok, true, secondWrite.ok ? undefined : secondWrite.detail)

      const statusAfter = rawGit(repo, ['status', '--porcelain'])
      assert.equal(statusAfter.status, 0)
      assert.equal(statusAfter.stdout, statusBefore.stdout)

      const readBackAgain = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:threads/${second.record.id}.json`])
      assert.equal(readBackAgain.ok, true)
      if (readBackAgain.ok) assert.deepEqual(JSON.parse(readBackAgain.stdout), second.record)
    })
  })
})

test('store.never-reads-head', async (t) => {
  await t.test('detached HEAD', () => {
    withRepo((repo) => {
      withPluginData((pluginData) => {
        assert.equal(rawGit(repo, ['commit', '--allow-empty', '-m', 'second commit']).status, 0)
        const headSha = rawGit(repo, ['rev-parse', 'HEAD']).stdout.trim()
        assert.equal(rawGit(repo, ['checkout', headSha]).status, 0)

        const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginData } })
        const layout = layoutIn(rt, repo)
        const change = makeThread(rt, 'written-detached')
        const write = writeRecords(rt, layout, [change], 'written detached')
        assert.equal(write.ok, true, write.ok ? undefined : write.detail)
      })
    })
  })

  await t.test('mid-rebase stopped at a conflict', () => {
    withRepo((repo) => {
      withPluginData((pluginData) => {
        assert.equal(rawGit(repo, ['switch', '-c', 'side']).status, 0)
        writeFileSync(join(repo, 'conflict.txt'), 'side value\n')
        assert.equal(rawGit(repo, ['add', 'conflict.txt']).status, 0)
        assert.equal(rawGit(repo, ['commit', '-m', 'side change']).status, 0)

        assert.equal(rawGit(repo, ['switch', 'main']).status, 0)
        writeFileSync(join(repo, 'conflict.txt'), 'main value\n')
        assert.equal(rawGit(repo, ['add', 'conflict.txt']).status, 0)
        assert.equal(rawGit(repo, ['commit', '-m', 'main change']).status, 0)

        const rebase = rawGit(repo, ['rebase', '--onto', 'main', 'main', 'side'])
        assert.notEqual(rebase.status, 0)
        assert.equal(existsSync(join(repo, '.git', 'rebase-merge')), true)

        const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginData } })
        const layout = layoutIn(rt, repo)
        const change = makeThread(rt, 'written-mid-rebase')
        const write = writeRecords(rt, layout, [change], 'written mid-rebase')
        assert.equal(write.ok, true, write.ok ? undefined : write.detail)
      })
    })
  })

  await t.test('unborn branch', () => {
    withRepo((repo) => {
      withPluginData((pluginData) => {
        assert.equal(rawGit(repo, ['switch', '--orphan', 'unborn']).status, 0)
        const head = rawGit(repo, ['rev-parse', 'HEAD'])
        assert.notEqual(head.status, 0)

        const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginData } })
        const layout = layoutIn(rt, repo)
        const change = makeThread(rt, 'written-unborn')
        const write = writeRecords(rt, layout, [change], 'written unborn')
        assert.equal(write.ok, true, write.ok ? undefined : write.detail)
      })
    })
  })
})

test('sync.identity', () => {
  withRepo((repo) => {
    const rt = testRuntime()
    const configured = readIdentity(rt, repo)
    assert.equal(configured.ok, true)
    if (!configured.ok) return

    const callerIdentity: Identity = { name: 'Ledger Caller', email: 'caller@logbook.test' }
    assert.notEqual(callerIdentity.name, configured.value.name)
    assert.notEqual(callerIdentity.email, configured.value.email)

    const tree = rawGit(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim()

    const first = git(rt, repo, ['commit-tree', tree, '-m', 'entry one'], { identity: callerIdentity })
    assert.equal(first.ok, true)
    if (!first.ok) return
    const firstSha = first.stdout.trim()
    const casFirst = casUpdateRef(rt, repo, LEDGER_REF, firstSha, null)
    assert.equal(casFirst.ok, true)

    const second = git(rt, repo, ['commit-tree', tree, '-p', firstSha, '-m', 'entry two'], {
      identity: callerIdentity
    })
    assert.equal(second.ok, true)
    if (!second.ok) return
    const secondSha = second.stdout.trim()
    const casSecond = casUpdateRef(rt, repo, LEDGER_REF, secondSha, firstSha)
    assert.equal(casSecond.ok, true)

    const log = rawGit(repo, ['log', '--format=%an|%ae|%cn|%ce', LEDGER_REF])
    assert.equal(log.status, 0)
    const lines = log.stdout.trim().split('\n')
    assert.equal(lines.length, 2)
    for (const line of lines) {
      const [an, ae, cn, ce] = line.split('|')
      assert.equal(an, callerIdentity.name)
      assert.equal(ae, callerIdentity.email)
      assert.equal(cn, callerIdentity.name)
      assert.equal(ce, callerIdentity.email)
      assert.notEqual(an, configured.value.name)
      assert.notEqual(ae, configured.value.email)
    }
  })
})

test('sync.identity-refuses-when-unconfigured', () => {
  withRepoNoIdentity((repo) => {
    const rt = testRuntime()
    const identity = readIdentity(rt, repo)
    assert.equal(identity.ok, false)
    if (identity.ok) return
    assert.equal(identity.retryable, true)
    assert.match(identity.field, /user\.name/)
    assert.match(identity.field, /user\.email/)
    assert.match(identity.message, /no git identity is configured/)
  })
})

test('git.strips-inherited-git-dir', () => {
  withRepo((repoA) => {
    withRepo((repoB) => {
      const rt = testRuntime({ env: { GIT_DIR: join(repoB, '.git') } })

      const tree = rawGit(repoA, ['rev-parse', 'HEAD^{tree}']).stdout.trim()
      const commit = git(rt, repoA, ['commit-tree', tree, '-m', 'gitdir isolation probe'], {
        identity: { name: 'Probe', email: 'probe@logbook.test' }
      })
      assert.equal(commit.ok, true)
      if (!commit.ok) return
      const sha = commit.stdout.trim()

      const cas = casUpdateRef(rt, repoA, LEDGER_REF, sha, null)
      assert.equal(cas.ok, true)

      const inRepoA = rawGit(repoA, ['rev-parse', LEDGER_REF])
      assert.equal(inRepoA.status, 0)
      assert.equal(inRepoA.stdout.trim(), sha)

      const inRepoB = rawGit(repoB, ['rev-parse', LEDGER_REF])
      assert.notEqual(inRepoB.status, 0)
    })
  })
})

test('git.cleans-up-its-own-index-file', () => {
  withRepo((repo) => {
    const rt = testRuntime()
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('logbook-git-index-'))

    const blob = git(rt, repo, ['hash-object', '-w', '--stdin'], { stdin: 'index cleanup probe' })
    assert.equal(blob.ok, true)
    if (!blob.ok) return

    const addEntry = git(rt, repo, [
      'update-index',
      '--add',
      '--cacheinfo',
      `100644,${blob.stdout.trim()},probe.txt`
    ])
    assert.equal(addEntry.ok, true)

    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('logbook-git-index-'))
    assert.deepEqual(after, before)
  })
})

test('ref.classifies-cas-mismatch-vs-io-failure', () => {
  withRepo((repo) => {
    const rt = testRuntime()
    const tree = rawGit(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim()
    const identity: Identity = { name: 'Probe', email: 'probe@logbook.test' }

    const first = git(rt, repo, ['commit-tree', tree, '-m', 'ref classification probe one'], { identity })
    assert.equal(first.ok, true)
    if (!first.ok) return
    const firstSha = first.stdout.trim()
    const establish = casUpdateRef(rt, repo, LEDGER_REF, firstSha, null)
    assert.equal(establish.ok, true)

    const second = git(rt, repo, ['commit-tree', tree, '-p', firstSha, '-m', 'ref classification probe two'], {
      identity
    })
    assert.equal(second.ok, true)
    if (!second.ok) return
    const secondSha = second.stdout.trim()

    const mismatch = casUpdateRef(rt, repo, LEDGER_REF, secondSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    assert.equal(mismatch.ok, false)
    if (mismatch.ok) return
    assert.equal(mismatch.cause, 'ref-moved')
    assert.equal(mismatch.retryable, true)
    assert.equal(mismatch.field, LEDGER_REF)

    const nonGitDir = mkdtempSync(join(tmpdir(), 'logbook-non-git-'))
    try {
      const ioFailure = casUpdateRef(rt, nonGitDir, LEDGER_REF, secondSha, null)
      assert.equal(ioFailure.ok, false)
      if (ioFailure.ok) return
      assert.equal(ioFailure.cause, 'io')
      assert.equal(ioFailure.retryable, false)
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true })
    }
  })
})
