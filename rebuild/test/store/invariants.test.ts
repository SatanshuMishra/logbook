import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { git, readIdentity, type Identity } from '../../src/store/git.ts'
import { LEDGER_REF, casUpdateRef } from '../../src/store/ref.ts'

const RECORD_PATH = 'ledger/record.json'

type LedgerWriteOutcome = { ok: true; commit: string } | { ok: false; detail: string }

const writeLedgerRecord = (
  rt: Runtime,
  repo: string,
  identity: Identity,
  content: string,
  parent: string | null
): LedgerWriteOutcome => {
  const blob = git(rt, repo, ['hash-object', '-w', '--stdin'], { stdin: content })
  if (!blob.ok) return { ok: false, detail: `hash-object: ${blob.stderr}` }

  const indexFile = join(tmpdir(), `logbook-test-index-${randomUUID()}`)
  if (parent !== null) {
    const readTree = git(rt, repo, ['read-tree', parent], { indexFile })
    if (!readTree.ok) return { ok: false, detail: `read-tree: ${readTree.stderr}` }
  }

  const addEntry = git(
    rt,
    repo,
    ['update-index', '--add', '--cacheinfo', `100644,${blob.stdout.trim()},${RECORD_PATH}`],
    { indexFile }
  )
  if (!addEntry.ok) return { ok: false, detail: `update-index: ${addEntry.stderr}` }

  const writeTree = git(rt, repo, ['write-tree'], { indexFile })
  if (!writeTree.ok) return { ok: false, detail: `write-tree: ${writeTree.stderr}` }
  const tree = writeTree.stdout.trim()

  const commitArgs =
    parent === null
      ? ['commit-tree', tree, '-m', 'ledger write']
      : ['commit-tree', tree, '-p', parent, '-m', 'ledger write']
  const commit = git(rt, repo, commitArgs, { identity })
  if (!commit.ok) return { ok: false, detail: `commit-tree: ${commit.stderr}` }
  const commitSha = commit.stdout.trim()

  const cas = casUpdateRef(rt, repo, LEDGER_REF, commitSha, parent)
  if (!cas.ok) return { ok: false, detail: `update-ref: ${cas.message}` }

  return { ok: true, commit: commitSha }
}

const runtimeWithHome = (): Runtime => testRuntime({ env: { HOME: process.env.HOME } })

test('store.leaves-index-alone', () => {
  withRepo((repo) => {
    writeFileSync(join(repo, 'staged.txt'), 'a developer is mid-edit\n')
    const addStaged = rawGit(repo, ['add', 'staged.txt'])
    assert.equal(addStaged.status, 0)
    const before = rawGit(repo, ['diff', '--cached', '--name-status'])
    assert.equal(before.status, 0)

    const rt = runtimeWithHome()
    const identity = readIdentity(rt, repo)
    assert.equal(identity.ok, true)
    if (!identity.ok) return
    const write = writeLedgerRecord(rt, repo, identity.value, 'ledger content one', null)
    assert.equal(write.ok, true, write.ok ? undefined : write.detail)

    const after = rawGit(repo, ['diff', '--cached', '--name-status'])
    assert.equal(after.status, 0)
    assert.equal(after.stdout, before.stdout)
  })
})

test('store.survives-branch-switch', () => {
  withRepo((repo) => {
    const rt = runtimeWithHome()
    const identity = readIdentity(rt, repo)
    assert.equal(identity.ok, true)
    if (!identity.ok) return

    const first = writeLedgerRecord(rt, repo, identity.value, 'record before switching', null)
    assert.equal(first.ok, true, first.ok ? undefined : first.detail)
    if (!first.ok) return

    assert.equal(rawGit(repo, ['switch', '-c', 'b1']).status, 0)
    assert.equal(rawGit(repo, ['switch', '-c', 'b2']).status, 0)

    const readBack = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:${RECORD_PATH}`])
    assert.equal(readBack.ok, true)
    if (readBack.ok) assert.equal(readBack.stdout, 'record before switching')

    const statusBefore = rawGit(repo, ['status', '--porcelain'])
    assert.equal(statusBefore.status, 0)

    const second = writeLedgerRecord(rt, repo, identity.value, 'record after switching', first.commit)
    assert.equal(second.ok, true, second.ok ? undefined : second.detail)

    const statusAfter = rawGit(repo, ['status', '--porcelain'])
    assert.equal(statusAfter.status, 0)
    assert.equal(statusAfter.stdout, statusBefore.stdout)

    const readBackAgain = git(rt, repo, ['cat-file', '-p', `${LEDGER_REF}:${RECORD_PATH}`])
    assert.equal(readBackAgain.ok, true)
    if (readBackAgain.ok) assert.equal(readBackAgain.stdout, 'record after switching')
  })
})

test('store.never-reads-head', async (t) => {
  await t.test('detached HEAD', () => {
    withRepo((repo) => {
      assert.equal(rawGit(repo, ['commit', '--allow-empty', '-m', 'second commit']).status, 0)
      const headSha = rawGit(repo, ['rev-parse', 'HEAD']).stdout.trim()
      assert.equal(rawGit(repo, ['checkout', headSha]).status, 0)

      const rt = runtimeWithHome()
      const identity = readIdentity(rt, repo)
      assert.equal(identity.ok, true)
      if (!identity.ok) return
      const write = writeLedgerRecord(rt, repo, identity.value, 'written detached', null)
      assert.equal(write.ok, true, write.ok ? undefined : write.detail)
    })
  })

  await t.test('mid-rebase stopped at a conflict', () => {
    withRepo((repo) => {
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

      const rt = runtimeWithHome()
      const identity = readIdentity(rt, repo)
      assert.equal(identity.ok, true)
      if (!identity.ok) return
      const write = writeLedgerRecord(rt, repo, identity.value, 'written mid-rebase', null)
      assert.equal(write.ok, true, write.ok ? undefined : write.detail)
    })
  })

  await t.test('unborn branch', () => {
    withRepo((repo) => {
      assert.equal(rawGit(repo, ['switch', '--orphan', 'unborn']).status, 0)
      const head = rawGit(repo, ['rev-parse', 'HEAD'])
      assert.notEqual(head.status, 0)

      const rt = runtimeWithHome()
      const identity = readIdentity(rt, repo)
      assert.equal(identity.ok, true)
      if (!identity.ok) return
      const write = writeLedgerRecord(rt, repo, identity.value, 'written unborn', null)
      assert.equal(write.ok, true, write.ok ? undefined : write.detail)
    })
  })
})

test('sync.identity', () => {
  withRepo((repo) => {
    const rt = runtimeWithHome()
    const identity = readIdentity(rt, repo)
    assert.equal(identity.ok, true)
    if (!identity.ok) return

    const first = writeLedgerRecord(rt, repo, identity.value, 'entry one', null)
    assert.equal(first.ok, true, first.ok ? undefined : first.detail)
    if (!first.ok) return
    const second = writeLedgerRecord(rt, repo, identity.value, 'entry two', first.commit)
    assert.equal(second.ok, true, second.ok ? undefined : second.detail)

    const configuredName = rawGit(repo, ['config', '--get', 'user.name']).stdout.trim()
    const configuredEmail = rawGit(repo, ['config', '--get', 'user.email']).stdout.trim()

    const log = rawGit(repo, ['log', '--format=%an|%ae|%cn|%ce', LEDGER_REF])
    assert.equal(log.status, 0)
    const lines = log.stdout.trim().split('\n')
    assert.equal(lines.length, 2)
    for (const line of lines) {
      const [an, ae, cn, ce] = line.split('|')
      assert.equal(an, configuredName)
      assert.equal(ae, configuredEmail)
      assert.equal(cn, configuredName)
      assert.equal(ce, configuredEmail)
    }
  })
})
