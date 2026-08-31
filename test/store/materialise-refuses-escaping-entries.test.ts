import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { git, gitBuffer } from '../../src/store/git.ts'
import { materialiseTreeInto } from '../../src/store/materialise-tree.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const OFFENDING_REL_PATH = 'threads/../../escape.json'
const ESCAPE_BLOB_CONTENT = 'a record this call must never write outside the destination\n'

const buildEscapingLedgerTree = (rt: Runtime, repo: string): string => {
  const blob = git(rt, repo, ['hash-object', '-w', '--stdin'], { stdin: ESCAPE_BLOB_CONTENT })
  assert.equal(blob.ok, true, 'fixture could not write the blob the escaping entry would point at')
  if (!blob.ok) throw new Error('unreachable')
  const blobId = blob.stdout.trim()

  const escapeJsonTree = git(rt, repo, ['mktree'], { stdin: `100644 blob ${blobId}\tescape.json\n` })
  assert.equal(escapeJsonTree.ok, true, 'fixture could not build the tree carrying escape.json')
  if (!escapeJsonTree.ok) throw new Error('unreachable')

  const innerDotDotTree = git(rt, repo, ['mktree'], {
    stdin: `040000 tree ${escapeJsonTree.stdout.trim()}\t..\n`
  })
  assert.equal(innerDotDotTree.ok, true, 'fixture could not build the inner .. tree entry')
  if (!innerDotDotTree.ok) throw new Error('unreachable')

  const outerDotDotTree = git(rt, repo, ['mktree'], {
    stdin: `040000 tree ${innerDotDotTree.stdout.trim()}\t..\n`
  })
  assert.equal(outerDotDotTree.ok, true, 'fixture could not build the outer .. tree entry')
  if (!outerDotDotTree.ok) throw new Error('unreachable')

  const rootTree = git(rt, repo, ['mktree'], {
    stdin: `040000 tree ${outerDotDotTree.stdout.trim()}\tthreads\n`
  })
  assert.equal(rootTree.ok, true, 'fixture could not build the root tree carrying the threads entry')
  if (!rootTree.ok) throw new Error('unreachable')

  return rootTree.stdout.trim()
}

const withDestination = <T>(fn: (destination: string) => T): T => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'logbook-escaping-entry-'))
  const destination = join(scratchRoot, 'destination')
  try {
    return fn(destination)
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

test('store.a-tree-entry-escaping-the-destination-is-refused', () => {
  withRepo((repo) => {
    const rt = testRuntime({ env: { HOME: process.env.HOME } })

    const rootTreeId = buildEscapingLedgerTree(rt, repo)

    const listing = git(rt, repo, ['ls-tree', '-r', '-z', '--full-tree', rootTreeId])
    assert.equal(listing.ok, true, 'fixture could not list the crafted tree back out')
    if (!listing.ok) return
    assert.ok(
      listing.stdout.includes(OFFENDING_REL_PATH),
      `the crafted fixture tree must actually contain the offending path ${OFFENDING_REL_PATH} once git reconstructs it, got: ${JSON.stringify(listing.stdout)}`
    )

    withDestination((destination) => {
      const outcome = materialiseTreeInto(rt, repo, rootTreeId, destination, {
        runGit: git,
        runGitBuffer: gitBuffer
      })

      assert.equal(
        outcome.ok,
        false,
        'a ledger tree entry whose path escapes the destination must be refused, never materialised'
      )
      if (outcome.ok) return

      assert.ok(
        outcome.detail.includes(OFFENDING_REL_PATH),
        `expected the refusal to name the offending path ${OFFENDING_REL_PATH}; got: ${outcome.detail}`
      )

      const escapedFilePath = join(dirname(destination), 'escape.json')
      const parentListing = (() => {
        try {
          return readdirSync(dirname(destination))
        } catch {
          return []
        }
      })()
      assert.equal(
        parentListing.includes('escape.json'),
        false,
        `materialising a tree with an escaping entry must never write ${escapedFilePath}; found directory entries: ${parentListing.join(', ')}`
      )

      const destinationListing = (() => {
        try {
          return readdirSync(destination)
        } catch {
          return []
        }
      })()
      assert.deepEqual(
        destinationListing,
        [],
        `a refused materialisation must write nothing into the destination directory itself; found: ${destinationListing.join(', ')}`
      )
    })
  })
})
