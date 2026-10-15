import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OWN_FILE = fileURLToPath(import.meta.url)

const REMOVED_PATHS: readonly string[] = [
  'test/registers/size-limits.json',
  'test/support/limits-register.ts',
  'test/lint/limits-register.test.ts',
  'test/lint/limits-register-census.test.ts',
  'test/lint/no-literal-limits-in-descriptions.test.ts',
  'scripts/sync-limits-register-sites.mjs'
]

const SEARCHED_ROOTS: readonly string[] = ['bin', 'hooks', 'src', 'scripts', 'test']

const FORBIDDEN_TEXTS: readonly string[] = ['size-limits.json', 'limits-register']

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(full)
    return entry.isFile() ? [full] : []
  })

test('limits-register.is-gone', () => {
  const present = REMOVED_PATHS.filter((relative) => existsSync(join(REPO_ROOT, relative)))
  assert.deepEqual(present, [], `these limits register paths still exist: ${present.join(', ')}`)

  const searched = SEARCHED_ROOTS.flatMap((root) => {
    const dir = join(REPO_ROOT, root)
    return existsSync(dir) ? filesUnder(dir) : []
  }).filter((file) => file !== OWN_FILE)
  assert.ok(searched.length > 0, 'no file was found under bin, hooks, src, scripts or test')

  const naming = searched.flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return FORBIDDEN_TEXTS.filter((forbidden) => text.includes(forbidden)).map(
      (forbidden) => `${file.slice(REPO_ROOT.length)} names ${forbidden}`
    )
  })
  assert.deepEqual(naming, [], naming.join('\n'))
})
