import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error
import { checkPackaging } from '../../scripts/check-packaging.mjs'

const MAX_REPOSITORY_ROOT_ASCENTS = 10
const PLUGIN_MANIFEST_RELATIVE = path.join('.claude-plugin', 'plugin.json')

class RepositoryRootNotFoundError extends Error {
  constructor(startDir: string, maxAscents: number) {
    super(`packaging.test: could not find ${PLUGIN_MANIFEST_RELATIVE} within ${maxAscents} ascents of ${startDir}`)
    this.name = 'RepositoryRootNotFoundError'
  }
}

const findRepositoryRoot = (startDir: string): string => {
  let current = startDir
  for (let ascent = 0; ascent <= MAX_REPOSITORY_ROOT_ASCENTS; ascent += 1) {
    if (existsSync(path.join(current, PLUGIN_MANIFEST_RELATIVE))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new RepositoryRootNotFoundError(startDir, MAX_REPOSITORY_ROOT_ASCENTS)
}

const REPO_ROOT = findRepositoryRoot(path.dirname(fileURLToPath(import.meta.url)))

test('packaging.check-passes-on-the-shipped-layout', () => {
  const result = spawnSync(process.execPath, ['scripts/check-packaging.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })
  assert.equal(
    result.status,
    0,
    `packaging.check-passes-on-the-shipped-layout: expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
})

test('packaging.control.a-broken-manifest-is-rejected', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'logbook-packaging-control-'))
  try {
    writeFileSync(
      path.join(tempDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          ledger: {
            command: 'node',
            args: ['${CLAUDE_PLUGIN_ROOT}/bin/logbook-server.mjs']
          }
        }
      })
    )
    const { ok, problems } = await checkPackaging(tempDir)
    assert.equal(
      ok,
      false,
      `packaging.control.a-broken-manifest-is-rejected: expected the deliberately wrong .mcp.json to be rejected, got ok=true`
    )
    assert.ok(
      problems.some((problem: string) => problem.includes('.mcp.json')),
      `packaging.control.a-broken-manifest-is-rejected: expected a problem naming .mcp.json, got:\n${problems.join('\n')}`
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('packaging.control.a-lockfile-version-drift-is-rejected', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'logbook-packaging-lockfile-'))
  try {
    writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'logbook', version: '4.0.1' }))
    mkdirSync(path.join(tempDir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      path.join(tempDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'logbook', version: '4.0.1' })
    )
    writeFileSync(
      path.join(tempDir, 'package-lock.json'),
      JSON.stringify({
        name: 'logbook',
        version: '4.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'logbook',
            version: '4.0.0'
          }
        }
      })
    )
    const { ok, problems } = await checkPackaging(tempDir)
    assert.equal(
      ok,
      false,
      `packaging.control.a-lockfile-version-drift-is-rejected: expected the deliberately drifted package-lock.json to be rejected, got ok=true`
    )
    assert.ok(
      problems.some((problem: string) => problem.includes('package-lock.json') && problem.includes('4.0.0')),
      `packaging.control.a-lockfile-version-drift-is-rejected: expected a problem naming package-lock.json's drifted version, got:\n${problems.join('\n')}`
    )
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
