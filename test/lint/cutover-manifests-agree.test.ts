import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnServer } from '../support/spawn-client.ts'

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/
const REPO_ROOT_MARKER = path.join('.claude-plugin', 'plugin.json')
const REPO_ROOT_MAX_ASCENT = 10

const PACKAGE_JSON_LEG_IS_NEAR_TAUTOLOGICAL =
  'the server reads its own version from package.json at runtime, so the package.json-to-wire comparison is near tautological; its real value is proving the upward package.json search resolves to the repository package.json rather than a vendored node_modules copy, and that the server starts and completes the initialize handshake at all; plugin.json is the independent leg because nothing reads it at runtime and it can genuinely drift'

class RepoRootNotFoundError extends Error {
  constructor(startDir: string) {
    super(`RepoRootNotFoundError: walked up from ${startDir} without finding an ancestor containing ${REPO_ROOT_MARKER}`)
    this.name = 'RepoRootNotFoundError'
  }
}

const resolveRepoRoot = (): string => {
  const startDir = path.dirname(fileURLToPath(import.meta.url))
  let dir = startDir
  for (let step = 0; step < REPO_ROOT_MAX_ASCENT; step += 1) {
    if (existsSync(path.join(dir, REPO_ROOT_MARKER))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new RepoRootNotFoundError(startDir)
}

const readManifestVersion = (filePath: string): string => {
  const raw = readFileSync(filePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`readManifestVersion: ${filePath} did not parse to a JSON object`)
  }
  const version = (parsed as Record<string, unknown>).version
  if (typeof version !== 'string') {
    throw new Error(`readManifestVersion: ${filePath} has no string "version" field, got ${JSON.stringify(version)}`)
  }
  return version
}

test('cutover.manifests-agree', async () => {
  const repoRoot = resolveRepoRoot()
  const packageJsonPath = path.join(repoRoot, 'package.json')
  assert.strictEqual(existsSync(packageJsonPath), true, `resolved repo root ${repoRoot} has no package.json`)

  const packageJsonVersion = readManifestVersion(packageJsonPath)
  assert.match(
    packageJsonVersion,
    SEMVER_PATTERN,
    `${packageJsonPath} version is ${packageJsonVersion}, which is not a plain three-part semver; every other version assertion in this test is derived from it`
  )

  const pluginJsonPath = path.join(repoRoot, '.claude-plugin', 'plugin.json')
  const pluginJsonVersion = readManifestVersion(pluginJsonPath)
  assert.strictEqual(
    pluginJsonVersion,
    packageJsonVersion,
    `${pluginJsonPath} version is ${pluginJsonVersion}, but ${packageJsonPath} version is ${packageJsonVersion}`
  )

  const entry = path.join(repoRoot, 'bin', 'logbook-server.ts')
  const spawned = await spawnServer({ projectRoot: repoRoot, entry })
  try {
    const info = spawned.client.getServerVersion()
    if (info === undefined) {
      assert.fail('the initialize handshake returned no serverInfo; the wire version is unobservable')
    }
    assert.strictEqual(info.name, 'logbook')

    assert.strictEqual(
      packageJsonVersion,
      info.version,
      `${packageJsonVersion} (package.json) disagrees with ${info.version} (wire). ${PACKAGE_JSON_LEG_IS_NEAR_TAUTOLOGICAL}`
    )
    assert.strictEqual(
      pluginJsonVersion,
      info.version,
      `${pluginJsonVersion} (plugin.json) disagrees with ${info.version} (wire)`
    )
  } finally {
    await spawned.close()
  }
})
