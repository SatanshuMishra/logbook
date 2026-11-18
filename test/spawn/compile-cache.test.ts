import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SPAWN_BACKSTOP_MS = 60000

const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]
  )

const runEntryAlone = (entry: string, stdin: string) => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-cc-home-'))
  const temp = mkdtempSync(join(tmpdir(), 'logbook-cc-tmp-'))
  try {
    const result = spawnSync(process.execPath, [join(PROJECT_ROOT, entry)], {
      cwd: PROJECT_ROOT,
      input: stdin,
      env: { PATH: process.env.PATH ?? '', HOME: home, TMPDIR: temp },
      encoding: 'utf8',
      timeout: SPAWN_BACKSTOP_MS
    })
    const cacheDir = join(temp, 'node-compile-cache')
    return {
      status: result.status,
      cacheFiles: existsSync(cacheDir) ? filesUnder(cacheDir) : [],
      homeFiles: filesUnder(home)
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(temp, { recursive: true, force: true })
  }
}

test('compile-cache.session-start-hook-fills-the-cache', () => {
  const run = runEntryAlone('hooks/session-start.ts', '{}')
  assert.equal(run.status, 0)
  assert.ok(run.cacheFiles.length >= 1)
  assert.deepEqual(run.homeFiles, [])
})

test('compile-cache.session-end-hook-fills-the-cache', () => {
  const run = runEntryAlone('hooks/session-end.ts', '{}')
  assert.equal(run.status, 0)
  assert.ok(run.cacheFiles.length >= 1)
})

test('compile-cache.logbook-command-fills-the-cache', () => {
  const run = runEntryAlone('bin/logbook-cli.ts', '')
  assert.ok(run.cacheFiles.length >= 1)
})
