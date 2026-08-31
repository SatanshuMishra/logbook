import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

const OFFENDING_REL_PATH = 'threads/pwn.json'

const runtimeWithHome = (pluginData: string): Runtime =>
  testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })

const withPluginData = <T>(fn: (pluginData: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-non-regular-entry-plugin-data-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const withHarmlessSymlinkTarget = <T>(fn: (targetPath: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-non-regular-entry-target-'))
  const targetPath = join(dir, 'harmless.txt')
  writeFileSync(targetPath, 'harmless symlink target owned by this test\n', 'utf8')
  try {
    return fn(targetPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const pointLedgerRefAtASymlinkEntry = (rt: Runtime, repo: string, targetPath: string): void => {
  const blob = git(rt, repo, ['hash-object', '-w', '--stdin'], { stdin: targetPath })
  assert.equal(blob.ok, true, 'fixture could not write the blob a symlink entry would point at')
  if (!blob.ok) return

  const innerTree = git(rt, repo, ['mktree'], { stdin: `120000 blob ${blob.stdout.trim()}\tpwn.json\n` })
  assert.equal(innerTree.ok, true, 'fixture could not build the subtree carrying the symlink entry')
  if (!innerTree.ok) return

  const outerTree = git(rt, repo, ['mktree'], { stdin: `040000 tree ${innerTree.stdout.trim()}\tthreads\n` })
  assert.equal(outerTree.ok, true, 'fixture could not build the tree carrying the threads subtree')
  if (!outerTree.ok) return

  const commit = git(rt, repo, ['commit-tree', outerTree.stdout.trim(), '-m', 'a tree holding a non-regular entry'])
  assert.equal(commit.ok, true, 'fixture could not commit the tree holding the non-regular entry')
  if (!commit.ok) return

  const updated = git(rt, repo, ['update-ref', LEDGER_REF, commit.stdout.trim()])
  assert.equal(updated.ok, true, 'fixture could not point the ledger ref at the crafted commit')
}

const refusalText = (refusal: { message: string }): string => {
  const detail = (refusal as unknown as { detail?: string }).detail
  return detail === undefined ? refusal.message : `${refusal.message} ${detail}`
}

test('store.a-non-regular-tree-entry-is-refused', () => {
  withHarmlessSymlinkTarget((targetPath) => {
    withRepo((repo) => {
      withPluginData((pluginData) => {
        const rt = runtimeWithHome(pluginData)

        pointLedgerRefAtASymlinkEntry(rt, repo, targetPath)

        const opened = openStore(rt, repo)

        assert.equal(
          opened.ok,
          false,
          'a ledger tree entry whose mode is not 100644 must be refused by name, not materialised as a real file'
        )
        if (opened.ok) return

        assert.ok(
          refusalText(opened).includes(OFFENDING_REL_PATH),
          `expected the refusal to name the offending path ${OFFENDING_REL_PATH}; got: ${refusalText(opened)}`
        )

        const layout = layoutFor(rt, repo)
        assert.equal(layout.ok, true)
        if (!layout.ok) return

        const materialisedPath = join(layout.value.records, 'threads', 'pwn.json')
        let isSymlink = false
        try {
          isSymlink = lstatSync(materialisedPath).isSymbolicLink()
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        assert.equal(
          isSymlink,
          false,
          `expected no symbolic link to exist at ${materialisedPath} after a refused materialisation`
        )
      })
    })
  })
})
