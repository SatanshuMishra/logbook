import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { census, type Classified } from '../support/census.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const SCANNED_ROOTS = ['src', 'hooks', 'bin'] as const

const NUL_BYTE = 0

export type SourceByteEntry = { path: string; entryKind: 'regular-file' | 'other' }

const walkRoot = (absoluteDir: string, relativeDir: string): SourceByteEntry[] =>
  readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(absoluteDir, entry.name)
    const relative = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) return walkRoot(absolute, relative)
    if (entry.isFile()) return [{ path: relative, entryKind: 'regular-file' as const }]
    return [{ path: relative, entryKind: 'other' as const }]
  })

export const scanSourceRoots = (projectRoot: string): SourceByteEntry[] =>
  SCANNED_ROOTS.flatMap((root) => walkRoot(path.join(projectRoot, root), root))

const readBytes = (absolutePath: string): Buffer | null => {
  try {
    return readFileSync(absolutePath)
  } catch {
    return null
  }
}

export const classifySourceBytes = (
  projectRoot: string,
  entry: SourceByteEntry
): Classified<SourceByteEntry>['verdict'] | 'unclassifiable' => {
  if (entry.entryKind !== 'regular-file') return 'unclassifiable'
  const bytes = readBytes(path.join(projectRoot, entry.path))
  if (bytes === null) return 'unclassifiable'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 'forbidden'
  }
  return bytes.includes(NUL_BYTE) ? 'forbidden' : 'allowed'
}

const describePopulation = (projectRoot: string, population: readonly SourceByteEntry[]): string => {
  const violations = population.filter((entry) => classifySourceBytes(projectRoot, entry) !== 'allowed')
  return [
    `contract.source-is-greppable-text: ${violations.length} of ${population.length} scanned entries are not greppable text`,
    ...violations.map((entry) => `${entry.path} [${classifySourceBytes(projectRoot, entry)}]`)
  ].join('\n')
}

test('contract.source-is-greppable-text', () => {
  const population = scanSourceRoots(PROJECT_ROOT)
  for (const root of SCANNED_ROOTS) {
    assert.ok(
      population.some((entry) => entry.path.startsWith(`${root}/`)),
      `contract.source-is-greppable-text: the walk found no entry under ${root}/; a census over a missing root proves nothing`
    )
  }
  assert.doesNotThrow(
    () => census(population, (entry) => classifySourceBytes(PROJECT_ROOT, entry)),
    describePopulation(PROJECT_ROOT, population)
  )
})

test('contract.source-is-greppable-text.control.a-nul-byte-is-forbidden-and-named', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-nul-'))
  writeFileSync(path.join(fixtureRoot, 'carries-a-nul.ts'), Buffer.from([0x61, 0x00, 0x62]))
  const entry: SourceByteEntry = { path: 'carries-a-nul.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'forbidden')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('carries-a-nul.ts')
  )
})

test('contract.source-is-greppable-text.control.an-invalid-utf8-byte-is-forbidden-and-named', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-utf8-'))
  writeFileSync(path.join(fixtureRoot, 'carries-a-lone-continuation.ts'), Buffer.from([0x61, 0xff, 0x62]))
  const entry: SourceByteEntry = { path: 'carries-a-lone-continuation.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'forbidden')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('carries-a-lone-continuation.ts')
  )
})

test('contract.source-is-greppable-text.control.plain-utf8-text-is-allowed', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-plain-'))
  writeFileSync(path.join(fixtureRoot, 'plain.ts'), 'export const value = 1\n', 'utf8')
  const entry: SourceByteEntry = { path: 'plain.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'allowed')
  assert.doesNotThrow(() => census([entry], (item) => classifySourceBytes(fixtureRoot, item)))
})

test('contract.source-is-greppable-text.control.an-entry-that-is-not-a-regular-file-halts-the-census', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-other-'))
  const entry: SourceByteEntry = { path: 'a-named-pipe', entryKind: 'other' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'unclassifiable')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('a-named-pipe')
  )
})

test('contract.source-is-greppable-text.control.an-unreadable-file-halts-the-census', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'logbook-greppable-missing-'))
  const entry: SourceByteEntry = { path: 'never-written.ts', entryKind: 'regular-file' }
  assert.equal(classifySourceBytes(fixtureRoot, entry), 'unclassifiable')
  assert.throws(
    () => census([entry], (item) => classifySourceBytes(fixtureRoot, item)),
    (error: unknown) => error instanceof Error && error.message.includes('never-written.ts')
  )
})
