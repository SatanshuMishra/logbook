import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { git, gitBuffer } from '../../src/store/git.ts'
import { materialiseTreeInto } from '../../src/store/materialise-tree.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const ESCAPE_BLOB_CONTENT = 'a record a .git-equivalent directory must never let git read config from\n'
const ZERO_WIDTH_NON_JOINER = '‌'

const buildForbiddenSegmentTree = (
  rt: Runtime,
  repo: string,
  segment: string
): { rootTreeId: string; expectedRelPath: string } => {
  const blob = git(rt, repo, ['hash-object', '-w', '--stdin'], { stdin: ESCAPE_BLOB_CONTENT })
  assert.equal(blob.ok, true, 'fixture could not write the blob the forbidden-segment entry would point at')
  if (!blob.ok) throw new Error('unreachable')
  const blobId = blob.stdout.trim()

  const innerTree = git(rt, repo, ['mktree'], { stdin: `100644 blob ${blobId}\tescape.json\n` })
  assert.equal(innerTree.ok, true, 'fixture could not build the tree carrying escape.json')
  if (!innerTree.ok) throw new Error('unreachable')

  const rootTree = git(rt, repo, ['mktree'], {
    stdin: `040000 tree ${innerTree.stdout.trim()}\t${segment}\n`
  })
  assert.equal(rootTree.ok, true, `fixture could not build a tree carrying the segment ${JSON.stringify(segment)}`)
  if (!rootTree.ok) throw new Error('unreachable')

  return { rootTreeId: rootTree.stdout.trim(), expectedRelPath: `${segment}/escape.json` }
}

const withDestination = <T>(fn: (destination: string) => T): T => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'logbook-dotgit-equivalent-'))
  const destination = join(scratchRoot, 'destination')
  try {
    return fn(destination)
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

const assertSegmentIsRefused = (rt: Runtime, repo: string, segment: string): void => {
  const { rootTreeId, expectedRelPath } = buildForbiddenSegmentTree(rt, repo, segment)

  const listing = git(rt, repo, ['ls-tree', '-r', '-z', '--full-tree', rootTreeId])
  assert.equal(listing.ok, true, 'fixture could not list the crafted tree back out')
  if (!listing.ok) return
  assert.ok(
    listing.stdout.includes(expectedRelPath),
    `the crafted fixture tree must actually contain ${JSON.stringify(expectedRelPath)} once git reconstructs it, got: ${JSON.stringify(listing.stdout)}`
  )

  withDestination((destination) => {
    const outcome = materialiseTreeInto(rt, repo, rootTreeId, destination, {
      runGit: git,
      runGitBuffer: gitBuffer
    })

    assert.equal(
      outcome.ok,
      false,
      `a ledger tree entry naming ${JSON.stringify(segment)} resolves to a .git directory on a platform this ships to and must be refused, never materialised`
    )
    if (outcome.ok) return

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
}

test('store.a-case-variant-of-dotgit-is-refused', () => {
  withRepo((repo) => {
    const rt = testRuntime({ env: { HOME: process.env.HOME } })
    assertSegmentIsRefused(rt, repo, '.GIT')
  })
})

test('store.a-windows-trailing-dot-variant-of-dotgit-is-refused', () => {
  withRepo((repo) => {
    const rt = testRuntime({ env: { HOME: process.env.HOME } })
    assertSegmentIsRefused(rt, repo, '.git.')
  })
})

test('store.a-windows-trailing-space-variant-of-dotgit-is-refused', () => {
  withRepo((repo) => {
    const rt = testRuntime({ env: { HOME: process.env.HOME } })
    assertSegmentIsRefused(rt, repo, '.git ')
  })
})

test('store.a-zero-width-non-joiner-variant-of-dotgit-is-refused', () => {
  withRepo((repo) => {
    const rt = testRuntime({ env: { HOME: process.env.HOME } })
    assertSegmentIsRefused(rt, repo, `.g${ZERO_WIDTH_NON_JOINER}it`)
  })
})

test('store.the-ntfs-short-name-of-dotgit-is-refused', () => {
  withRepo((repo) => {
    const rt = testRuntime({ env: { HOME: process.env.HOME } })
    assertSegmentIsRefused(rt, repo, 'git~1')
  })
})
