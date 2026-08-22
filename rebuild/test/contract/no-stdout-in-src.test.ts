import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'

const REBUILD_SRC = fileURLToPath(new URL('../../src', import.meta.url))
const ALLOWED_FILE = 'server/main.ts'

const KNOWN_KINDS = new Set([
  'process.stdout',
  'console.log',
  'console.info',
  'console.dir',
  'console.table',
  'console.warn'
])

const HIT_PATTERN = /\bprocess\.stdout\b|\bconsole\.(\w+)\b/g

type Hit = { file: string; kind: string }

const walkTsFiles = (root: string): string[] => {
  if (!fs.existsSync(root)) return []
  const entries = fs.readdirSync(root, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) return walkTsFiles(full)
    if (entry.isFile() && entry.name.endsWith('.ts')) return [full]
    return []
  })
}

const MISSING_ROOT = fileURLToPath(new URL('../../src-does-not-exist', import.meta.url))

const findHits = (root: string): Hit[] => {
  const hits: Hit[] = []
  for (const file of walkTsFiles(root)) {
    const relative = path.relative(root, file)
    const contents = fs.readFileSync(file, 'utf8')
    for (const match of contents.matchAll(HIT_PATTERN)) {
      const kind = match[0].startsWith('process.stdout') ? 'process.stdout' : `console.${match[1]}`
      hits.push({ file: relative, kind })
    }
  }
  return hits
}

const classifyHit = (hit: Hit): Classified<Hit>['verdict'] | 'unclassifiable' => {
  if (!KNOWN_KINDS.has(hit.kind)) return 'unclassifiable'
  return hit.file === ALLOWED_FILE ? 'allowed' : 'forbidden'
}

test('contract.no-stdout-in-src', () => {
  const scanned = walkTsFiles(REBUILD_SRC)
  assert.ok(scanned.length > 0, `expected the walk to find .ts files under ${REBUILD_SRC}`)

  const hits = findHits(REBUILD_SRC)
  assert.doesNotThrow(() => census(hits, classifyHit))

  const synthetic: Hit[] = [{ file: 'store/git.ts', kind: 'console.log' }]
  assert.throws(() => census(synthetic, classifyHit))
})

test('contract.no-stdout-in-src.walk-finds-nothing-at-a-missing-root', () => {
  assert.equal(walkTsFiles(MISSING_ROOT).length, 0)
})
