import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const TEST_ROOT = path.join(PROJECT_ROOT, 'test')
const LIVE_PREFIX = 'test/live/'
const THIS_FILE = 'test/lint/home-isolation.test.ts'
const FIXTURE_FILE = 'test/fixtures/home-writer.fixture.ts'
const EXCLUDED_FILES: ReadonlySet<string> = new Set([THIS_FILE, FIXTURE_FILE])
const SUITE_TIMEOUT_MS = 600000
const OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024

const REAL_HOME_PATTERNS: readonly RegExp[] = [
  /process\.env\.HOME\b/,
  /process\.env\[\s*'HOME'\s*\]/,
  /process\.env\[\s*"HOME"\s*\]/,
  /\bhomedir\(/,
  /\buserInfo\(/,
  /\.\.\.process\.env\b/,
  /\benv:\s*process\.env\b(?!\s*[.[])/
]

const relativePath = (absolute: string): string => path.relative(PROJECT_ROOT, absolute).split(path.sep).join('/')

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.isFile() ? [full] : []
  })

const censusedFiles = (): string[] =>
  walk(TEST_ROOT)
    .map(relativePath)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => !file.startsWith(LIVE_PREFIX) && !EXCLUDED_FILES.has(file))
    .sort()

const realHomeMatches = (file: string): string[] =>
  readFileSync(path.join(PROJECT_ROOT, file), 'utf8')
    .split('\n')
    .flatMap((line, index) => (REAL_HOME_PATTERNS.some((pattern) => pattern.test(line)) ? [`${file}:${index + 1}`] : []))

const childEnv = (home: string): Record<string, string> => {
  const pathValue = process.env.PATH
  const tmpdirValue = process.env.TMPDIR
  return {
    ...(pathValue === undefined ? {} : { PATH: pathValue }),
    ...(tmpdirValue === undefined ? {} : { TMPDIR: tmpdirValue }),
    HOME: home
  }
}

const testGlobs = (): string[] => {
  const manifest: unknown = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
  assert.ok(typeof manifest === 'object' && manifest !== null, 'package.json must hold an object')
  const scripts = (manifest as Record<string, unknown>).scripts
  assert.ok(typeof scripts === 'object' && scripts !== null, 'package.json must hold scripts')
  const testScript = (scripts as Record<string, unknown>).test
  assert.equal(typeof testScript, 'string', 'package.json must hold a test script')
  return [...String(testScript).matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '').filter((glob) => glob !== '')
}

const withFreshHome = <T>(prefix: string, fn: (home: string) => T): T => {
  const home = mkdtempSync(path.join(tmpdir(), prefix))
  try {
    return fn(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const tail = (text: string): string => text.split('\n').slice(-80).join('\n')

test('no test can write under the HOME the suite started with', () => {
  const files = censusedFiles()
  assert.ok(files.length > 0, 'the census found no test sources; a census over nothing proves nothing')
  const matches = files.flatMap(realHomeMatches)
  assert.equal(matches.length, 0, `test sources name the real HOME:\n${matches.join('\n')}`)

  withFreshHome('logbook-home-isolation-fixture-', (home) => {
    const run = spawnSync(process.execPath, ['--test', FIXTURE_FILE], {
      cwd: PROJECT_ROOT,
      env: childEnv(home),
      encoding: 'utf8'
    })
    assert.equal(run.status, 0, `the fixture run must pass:\n${run.stdout}\n${run.stderr}`)
    assert.ok(readdirSync(home).length > 0, 'the fixture wrote under its HOME, so the check must see a file there')
  })

  const globs = testGlobs()
  assert.ok(globs.length > 0, "package.json's test script names no quoted globs")
  withFreshHome('logbook-home-isolation-suite-', (home) => {
    const run = spawnSync(process.execPath, ['--test', ...globs], {
      cwd: PROJECT_ROOT,
      env: childEnv(home),
      encoding: 'utf8',
      timeout: SUITE_TIMEOUT_MS,
      maxBuffer: OUTPUT_LIMIT_BYTES
    })
    assert.equal(run.status, 0, `the suite run must pass with a fresh HOME:\n${tail(run.stdout)}\n${tail(run.stderr)}`)
    const entries = readdirSync(home, { recursive: true, encoding: 'utf8' }).sort()
    assert.deepEqual(entries, [], `the suite wrote under its HOME:\n${entries.join('\n')}`)
  })
})
