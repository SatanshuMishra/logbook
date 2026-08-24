import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rawGit, type RawGitResult } from '../support/git-fixture.ts'
import { spawnServer } from '../support/spawn-client.ts'

const EXPECTED_TOOL_COUNT = 12

const GIT_ARCHIVE_IS_HEAD_NOT_WORKING_TREE =
  'git archive HEAD materialises the last commit, not the working tree; this is a post-commit gate, and on a dirty tree it proves nothing about uncommitted changes'

const LEGACY_PATHS = [
  'bin/ledger-server.mjs',
  'bin/ledger-cli.mjs',
  'hooks/commit-msg',
  'hooks/dispatcher',
  'hooks/lib',
  'src/drivers',
  'src/tools',
  'src/drift'
]

const EXPECTED_SKILL_FILES = ['skills/debrief/SKILL.md', 'skills/preflight/SKILL.md']

type MaterialisedTree = {
  workDir: string
  treeDir: string
  archiveResult: RawGitResult
  extractResult: SpawnSyncReturns<string>
}

const materialise = (): MaterialisedTree => {
  const startDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRootResult = rawGit(startDir, ['rev-parse', '--show-toplevel'])
  if (repoRootResult.status !== 0) {
    throw new Error(`install.test: git rev-parse --show-toplevel failed: ${repoRootResult.stderr}`)
  }
  const repoRoot = repoRootResult.stdout.trim()
  const workDir = mkdtempSync(path.join(tmpdir(), 'logbook-install-work-'))
  const treeDir = mkdtempSync(path.join(tmpdir(), 'logbook-install-tree-'))
  const tarPath = path.join(workDir, 'tree.tar')
  const archiveResult = rawGit(repoRoot, ['archive', '--format=tar', '-o', tarPath, 'HEAD'])
  const extractResult = spawnSync('tar', ['-x', '-f', tarPath, '-C', treeDir], { encoding: 'utf8' })
  return { workDir, treeDir, archiveResult, extractResult }
}

const walkFiles = (root: string, dir: string = root, results: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(root, full, results)
      continue
    }
    if (entry.isFile()) {
      results.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  return results
}

test('install.serves-new-server', async () => {
  const { workDir, treeDir, archiveResult, extractResult } = materialise()
  try {
    assert.strictEqual(
      archiveResult.status,
      0,
      `${GIT_ARCHIVE_IS_HEAD_NOT_WORKING_TREE}. git archive exited ${archiveResult.status}: ${archiveResult.stderr}`
    )
    assert.strictEqual(
      extractResult.status,
      0,
      `tar extract exited ${String(extractResult.status)}: ${extractResult.stderr}`
    )

    assert.strictEqual(
      existsSync(path.join(treeDir, '.git')),
      false,
      'git archive leaked a .git directory; this is not a git-tree-only materialisation'
    )
    assert.strictEqual(
      existsSync(path.join(treeDir, 'node_modules', '@modelcontextprotocol', 'sdk')),
      true,
      'the materialised tree has no vendored SDK; node_modules is no longer tracked and this test can no longer prove what it claims'
    )
    assert.strictEqual(existsSync(path.join(treeDir, 'package.json')), true)

    const entry = path.join(treeDir, 'bin', 'logbook-server.ts')
    const spawned = await spawnServer({ projectRoot: treeDir, entry })
    try {
      assert.notStrictEqual(spawned.client.getServerVersion(), undefined)
      const listed = await spawned.client.listTools()
      const sortedNames = listed.tools.map((tool) => tool.name).sort()
      assert.strictEqual(
        listed.tools.length,
        EXPECTED_TOOL_COUNT,
        `expected exactly ${EXPECTED_TOOL_COUNT} tools, found ${listed.tools.length}: ${sortedNames.join(', ')}`
      )
    } finally {
      await spawned.close()
    }

    const materialisedFiles = walkFiles(treeDir)
    const materialisedFileSet = new Set(materialisedFiles)
    for (const legacyPath of LEGACY_PATHS) {
      const stillPresent =
        materialisedFileSet.has(legacyPath) || materialisedFiles.some((file) => file.startsWith(`${legacyPath}/`))
      assert.strictEqual(stillPresent, false, `legacy path ${legacyPath} is present in the materialised tree`)
    }

    const skillFiles = materialisedFiles.filter((file) => file.startsWith('skills/') && file.endsWith('SKILL.md')).sort()
    assert.strictEqual(
      skillFiles.length,
      EXPECTED_SKILL_FILES.length,
      `expected exactly ${EXPECTED_SKILL_FILES.length} SKILL.md files under skills/, found ${skillFiles.length}: ${skillFiles.join(', ')}`
    )
    assert.deepStrictEqual(skillFiles, EXPECTED_SKILL_FILES)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    rmSync(treeDir, { recursive: true, force: true })
  }
})

test('install.no-build-output-was-materialised', () => {
  const { workDir, treeDir, archiveResult, extractResult } = materialise()
  try {
    assert.strictEqual(archiveResult.status, 0, `git archive exited ${archiveResult.status}: ${archiveResult.stderr}`)
    assert.strictEqual(
      extractResult.status,
      0,
      `tar extract exited ${String(extractResult.status)}: ${extractResult.stderr}`
    )

    assert.strictEqual(
      existsSync(path.join(treeDir, 'dist')),
      false,
      'a dist directory reached the materialised tree; gitignored build output must never be part of what a user runs'
    )
    assert.strictEqual(
      existsSync(path.join(treeDir, 'rebuild')),
      false,
      'the rebuild staging directory survived the cutover'
    )

    const jsFiles = walkFiles(treeDir).filter((file) => file.endsWith('.js'))
    assert.strictEqual(
      jsFiles.length,
      0,
      `found ${jsFiles.length} .js file(s) outside node_modules: ${jsFiles.slice(0, 10).join(', ')}`
    )
  } finally {
    rmSync(workDir, { recursive: true, force: true })
    rmSync(treeDir, { recursive: true, force: true })
  }
})
