import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CENSUSED_ROOTS = ['src', 'hooks', 'bin', 'scripts'] as const

const MODULE_EXTENSIONS = ['.ts', '.mjs', '.cjs', '.js'] as const
const NON_MODULE_EXTENSIONS = ['.json', '.sh', '.md', '.yml', '.yaml', ''] as const

const SPAWN_TOKENS = [
  'child_process',
  'execFileSync',
  'execFile',
  'execSync',
  'spawnSync',
  'spawn(',
  'fork(',
  'worker_threads'
] as const

const SPAWN_ALLOWLIST = ['src/store/git.ts', 'scripts/install-githooks.mjs', 'scripts/d6-check.cjs'] as const

const RECORD_TYPE_MODULES = ['schema/thread', 'schema/decision', 'schema/session', 'schema/binding'] as const

type SourceFile = { relPath: string; extension: string; text: string }

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (!entry.isFile()) return []
    return [full]
  })

const collectSourceFiles = (): SourceFile[] =>
  CENSUSED_ROOTS.flatMap((root) =>
    walk(path.join(PROJECT_ROOT, root)).map((full) => {
      const relPath = path.relative(PROJECT_ROOT, full).split(path.sep).join('/')
      return { relPath, extension: path.extname(relPath), text: readFileSync(full, 'latin1') }
    })
  )

const spawns = (file: SourceFile): boolean => SPAWN_TOKENS.some((token) => file.text.includes(token))

const importsARecordType = (file: SourceFile): boolean =>
  RECORD_TYPE_MODULES.some((module) => file.text.includes(module))

export const classifySpawnSite = (file: SourceFile): Classified<SourceFile>['verdict'] | 'unclassifiable' => {
  const allowlisted = (SPAWN_ALLOWLIST as readonly string[]).includes(file.relPath)
  if ((NON_MODULE_EXTENSIONS as readonly string[]).includes(file.extension)) {
    return allowlisted ? 'unclassifiable' : 'allowed'
  }
  if (!(MODULE_EXTENSIONS as readonly string[]).includes(file.extension)) return 'unclassifiable'
  if (!spawns(file)) return allowlisted ? 'unclassifiable' : 'allowed'
  if (!allowlisted) return 'forbidden'
  return importsARecordType(file) ? 'forbidden' : 'allowed'
}

test('spawn-allowlist.only-allowlisted-modules-spawn-and-none-imports-a-record-type', () => {
  const files = collectSourceFiles()
  assert.ok(files.length > 0, 'spawn-allowlist: the censused roots yielded no files; a census over an empty list proves nothing')

  const spawners = files.filter((file) => spawns(file)).map((file) => file.relPath).sort()
  assert.deepEqual(
    spawners,
    [...SPAWN_ALLOWLIST].sort(),
    'spawn-allowlist: the set of modules that spawn a process must equal the allowlist exactly'
  )

  assert.doesNotThrow(() => census(files, classifySpawnSite))
})

test('spawn-allowlist.control.an-unlisted-spawner-and-a-tainted-allowlisted-module-are-forbidden', () => {
  assert.equal(
    classifySpawnSite({
      relPath: 'src/probe/unlisted.ts',
      extension: '.ts',
      text: "import { execFileSync } from 'node:child_process'\n"
    }),
    'forbidden'
  )
  assert.equal(
    classifySpawnSite({
      relPath: 'src/store/git.ts',
      extension: '.ts',
      text: "import { execFileSync } from 'node:child_process'\nimport type { Thread } from '../schema/thread.ts'\n"
    }),
    'forbidden'
  )
  assert.equal(
    classifySpawnSite({
      relPath: 'src/store/git.ts',
      extension: '.ts',
      text: "import { execFileSync } from 'node:child_process'\n"
    }),
    'allowed'
  )
  assert.equal(
    classifySpawnSite({ relPath: 'scripts/d6-check.cjs', extension: '.cjs', text: 'const x = 1\n' }),
    'unclassifiable'
  )
  assert.equal(
    classifySpawnSite({ relPath: 'src/probe/thing.py', extension: '.py', text: 'import os\n' }),
    'unclassifiable'
  )
  assert.equal(
    classifySpawnSite({ relPath: 'src/schema/caps.ts', extension: '.ts', text: 'export const A = 1\n' }),
    'allowed'
  )
})
