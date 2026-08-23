import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Refusal } from '../../src/schema/declare.ts'
import { toolRefusal } from '../../src/server/errors.ts'
import { git, readIdentity, type Identity } from '../../src/store/git.ts'
import { createStoreDirectories, layoutFor } from '../../src/store/layout.ts'
import { openStore } from '../../src/store/records.ts'
import { LEDGER_REF, casUpdateRef } from '../../src/store/ref.ts'
import { ensureSingleStore } from '../../src/store/single-store.ts'
import { withDetail } from '../../src/store/detail.ts'
import { rawGit, withRepo, withRepoNoIdentity } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import {
  SENTINEL_POSIX,
  SENTINEL_TOKEN,
  SENTINEL_WIN32,
  classifyEmittedPath,
  emittedStrings,
  refusalTemplate,
  scanRefusalProducers,
  taintRefusal
} from '../support/refusal-census.ts'
import type { EmittedString, ProducerId } from '../support/refusal-census.ts'

type TaggedRefusal = { producer: ProducerId; refusal: Refusal }

const REFUSE_PRODUCER: ProducerId = 'schema/refusal.ts#refuse'
const LAYOUT_FOR_PRODUCER: ProducerId = 'store/layout.ts#layoutFor'
const CAS_UPDATE_REF_PRODUCER: ProducerId = 'store/ref.ts#casUpdateRef'
const READ_IDENTITY_PRODUCER: ProducerId = 'store/git.ts#readIdentity'
const ENSURE_SINGLE_STORE_PRODUCER: ProducerId = 'store/single-store.ts#ensureSingleStore'
const OPEN_STORE_PRODUCER: ProducerId = 'store/records.ts#openStore'
const WITH_DETAIL_PRODUCER: ProducerId = 'store/detail.ts#withDetail'

const collectRealRefusals = (): TaggedRefusal[] => {
  const refusals: TaggedRefusal[] = [
    { producer: REFUSE_PRODUCER, refusal: refusalTemplate() },
    { producer: WITH_DETAIL_PRODUCER, refusal: withDetail(refusalTemplate(), 'a store-relative detail') }
  ]

  const noPluginDataDir = mkdtempSync(join(tmpdir(), 'logbook-no-plugin-data-'))
  try {
    const rt = testRuntime({ env: {} })
    const result = layoutFor(rt, noPluginDataDir)
    if (result.ok) throw new Error('expected layoutFor to refuse when CLAUDE_PLUGIN_DATA is unset')
    refusals.push({ producer: LAYOUT_FOR_PRODUCER, refusal: result })
  } finally {
    rmSync(noPluginDataDir, { recursive: true, force: true })
  }

  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const missingPath = join(pluginDataRoot, 'does-not-exist', 'nested')
    const result = layoutFor(rt, missingPath)
    if (result.ok) throw new Error('expected layoutFor to refuse on a missing projectRoot')
    refusals.push({ producer: LAYOUT_FOR_PRODUCER, refusal: result })
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }

  withRepo((repo) => {
    const rt = testRuntime()
    const identity: Identity = { name: 'Census Probe', email: 'probe@logbook.test' }
    const tree = rawGit(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim()

    const first = git(rt, repo, ['commit-tree', tree, '-m', 'census probe one'], { identity })
    if (!first.ok) throw new Error('expected commit-tree to succeed while building the census fixture')
    const firstSha = first.stdout.trim()
    const establish = casUpdateRef(rt, repo, LEDGER_REF, firstSha, null)
    if (!establish.ok) throw new Error('expected the first cas update to succeed')

    const second = git(rt, repo, ['commit-tree', tree, '-p', firstSha, '-m', 'census probe two'], { identity })
    if (!second.ok) throw new Error('expected the second commit-tree to succeed')
    const secondSha = second.stdout.trim()

    const mismatch = casUpdateRef(rt, repo, LEDGER_REF, secondSha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
    if (mismatch.ok) throw new Error('expected a cas-mismatch refusal')
    refusals.push({ producer: CAS_UPDATE_REF_PRODUCER, refusal: mismatch })
  })

  const nonGitDir = mkdtempSync(join(tmpdir(), 'logbook-non-git-'))
  try {
    const rt = testRuntime()
    const ioFailure = casUpdateRef(rt, nonGitDir, LEDGER_REF, '1'.repeat(40), null)
    if (ioFailure.ok) throw new Error('expected an io refusal against a non-git directory')
    refusals.push({ producer: CAS_UPDATE_REF_PRODUCER, refusal: ioFailure })
  } finally {
    rmSync(nonGitDir, { recursive: true, force: true })
  }

  withRepoNoIdentity((repo) => {
    const rt = testRuntime()
    const identityFailure = readIdentity(rt, repo)
    if (identityFailure.ok) throw new Error('expected readIdentity to refuse against a repo with no configured identity')
    refusals.push({ producer: READ_IDENTITY_PRODUCER, refusal: identityFailure })
  })

  const duplicateStoreRoot = mkdtempSync(join(tmpdir(), 'logbook-duplicate-store-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: duplicateStoreRoot } })
    const projectRoot = mkdtempSync(join(tmpdir(), 'logbook-duplicate-store-project-'))
    try {
      const layout = layoutFor(rt, projectRoot)
      if (!layout.ok) throw new Error('expected layoutFor to resolve for the duplicate-store fixture')
      createStoreDirectories(layout.value)

      const conflictingKey = 'stale-store-for-the-same-project'
      const conflictingRoot = join(duplicateStoreRoot, conflictingKey)
      mkdirSync(join(conflictingRoot, 'state'), { recursive: true })
      writeFileSync(
        join(conflictingRoot, 'state', 'origin.json'),
        JSON.stringify({ project_root: layout.value.projectRoot }),
        'utf8'
      )

      const duplicateFailure = ensureSingleStore(rt, layout.value)
      if (duplicateFailure.ok) throw new Error('expected ensureSingleStore to refuse on a duplicate store')
      refusals.push({ producer: ENSURE_SINGLE_STORE_PRODUCER, refusal: duplicateFailure })
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  } finally {
    rmSync(duplicateStoreRoot, { recursive: true, force: true })
  }

  const unreadableRecordsPluginData = mkdtempSync(join(tmpdir(), 'logbook-unreadable-records-'))
  const unreadableRecordsProject = mkdtempSync(join(tmpdir(), 'logbook-unreadable-records-project-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: unreadableRecordsPluginData } })
    const first = openStore(rt, unreadableRecordsProject)
    if (!first.ok) throw new Error('expected the first openStore call to succeed and create the records directory')

    const layout = layoutFor(rt, unreadableRecordsProject)
    if (!layout.ok) throw new Error('expected layoutFor to resolve for the unreadable-records fixture')

    chmodSync(layout.value.records, 0o000)
    try {
      const unreadable = openStore(rt, unreadableRecordsProject)
      if (unreadable.ok) throw new Error('expected openStore to refuse against an unreadable records directory')
      refusals.push({ producer: OPEN_STORE_PRODUCER, refusal: unreadable })
    } finally {
      chmodSync(layout.value.records, 0o755)
    }
  } finally {
    rmSync(unreadableRecordsPluginData, { recursive: true, force: true })
    rmSync(unreadableRecordsProject, { recursive: true, force: true })
  }

  return refusals
}

test('error.discloses-no-path', () => {
  const tagged = collectRealRefusals()
  assert.ok(tagged.length > 0, 'expected at least one forced refusal to census')

  const scanned = scanRefusalProducers()
  assert.ok(scanned.length > 0, 'expected the static scan to find at least one refusal producer')
  const covered = new Set(tagged.map((t) => t.producer))
  const classifyProducerCoverage = (id: ProducerId): 'allowed' | 'unclassifiable' =>
    covered.has(id) ? 'allowed' : 'unclassifiable'
  assert.doesNotThrow(() => census(scanned, classifyProducerCoverage))

  const emitted = tagged.flatMap(({ refusal }) => emittedStrings(toolRefusal(refusal), refusal.example))
  assert.ok(emitted.length > 0, 'expected the rendered refusals to carry emitted strings')
  assert.doesNotThrow(() => census(emitted, classifyEmittedPath))

  const forbiddenPosix: EmittedString[] = [
    { path: 'content[0].text', value: `leaked at ${SENTINEL_POSIX}`, declaredExample: '' }
  ]
  assert.throws(() => census(forbiddenPosix, classifyEmittedPath))

  const forbiddenWin32: EmittedString[] = [
    { path: 'content[0].text', value: `leaked at ${SENTINEL_WIN32}`, declaredExample: '' }
  ]
  assert.throws(() => census(forbiddenWin32, classifyEmittedPath))
})

test('error.discloses-no-path.taint-refusal-rejects-unclosed-fields', () => {
  assert.throws(() => taintRefusal({} as Refusal, SENTINEL_TOKEN))

  const template = refusalTemplate()
  const corrupted = { ...template, retryable: 42 } as unknown as Refusal
  assert.throws(() => taintRefusal(corrupted, SENTINEL_TOKEN))
})

test('error.discloses-no-path.field-closure-halts-on-an-unforeseen-field', () => {
  const template = refusalTemplate()
  const knownKeys = new Set(Object.keys(template))
  const classifyRefusalKey = (key: string): 'allowed' | 'unclassifiable' =>
    knownKeys.has(key) ? 'allowed' : 'unclassifiable'

  const withSeventhField = taintRefusal({ ...template, hint: 'a future field' } as Refusal, SENTINEL_TOKEN)
  assert.throws(() => census(Object.keys(withSeventhField), classifyRefusalKey))
})

test('error.discloses-no-path.non-emitted-detail-is-not-enumerable', () => {
  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-detail-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const missingPath = join(pluginDataRoot, 'does-not-exist', 'nested')
    const result = layoutFor(rt, missingPath)
    if (result.ok) throw new Error('expected layoutFor to refuse on a missing projectRoot')
    const descriptor = Object.getOwnPropertyDescriptor(result, 'detail')
    assert.ok(descriptor !== undefined, 'expected a non-enumerable detail property carrying the store path')
    assert.equal(descriptor?.enumerable, false)
    assert.equal(Object.keys(result).includes('detail'), false)
    assert.equal(JSON.stringify(result).includes('detail'), false)
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('error.discloses-no-path.taint-survives-without-the-strip', () => {
  const template = refusalTemplate()
  const leaky = { ...template, cause: SENTINEL_POSIX } as Refusal & { cause: string }

  const withStrip = toolRefusal(leaky)
  assert.doesNotThrow(() => census(emittedStrings(withStrip, leaky.example), classifyEmittedPath))
  assert.equal(
    emittedStrings(withStrip, leaky.example).some((s) => s.value.includes(SENTINEL_TOKEN)),
    false
  )

  const withoutStrip: CallToolResult = {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(leaky) }]
  }
  assert.throws(() => census(emittedStrings(withoutStrip, leaky.example), classifyEmittedPath))
})

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))

test('error.discloses-no-path.producer-scan-covers-all-five-export-shapes', () => {
  const probeDir = join(SRC_ROOT, '__census_probe__')
  const probeFile = join(probeDir, 'plant.ts')
  mkdirSync(probeDir, { recursive: true })
  writeFileSync(
    probeFile,
    [
      "import type { Refusal } from '../schema/declare.ts'",
      '',
      'export function probeFunctionDeclaration(): Refusal {',
      "  return { ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' }",
      '}',
      '',
      'export const probeConciseArrow = (): Refusal =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      '',
      'export const probeAsyncArrow = async (): Promise<Refusal> =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      '',
      'const probeAssignedThenExported = (): Refusal =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      'export { probeAssignedThenExported }',
      '',
      'export type ProbeStoreFailure = Refusal',
      'export const probeTypeAliasReturn = (): ProbeStoreFailure =>',
      "  ({ ok: false, field: 'probe', accepted: 'probe', example: 'probe', retryable: false, message: 'leak' })",
      ''
    ].join('\n'),
    'utf8'
  )

  try {
    const scanned = scanRefusalProducers()
    const plantedFound = scanned.filter((id) => id.startsWith('__census_probe__/'))
    assert.deepEqual(
      new Set(plantedFound),
      new Set([
        '__census_probe__/plant.ts#probeFunctionDeclaration',
        '__census_probe__/plant.ts#probeConciseArrow',
        '__census_probe__/plant.ts#probeAsyncArrow',
        '__census_probe__/plant.ts#probeAssignedThenExported',
        '__census_probe__/plant.ts#probeTypeAliasReturn'
      ])
    )

    const classifyUncovered = (id: ProducerId): 'allowed' | 'unclassifiable' =>
      id.startsWith('__census_probe__/') ? 'unclassifiable' : 'allowed'
    assert.throws(() => census(scanned, classifyUncovered))
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }

  const scannedAfterCleanup = scanRefusalProducers()
  assert.equal(
    scannedAfterCleanup.some((id) => id.startsWith('__census_probe__/')),
    false
  )
})

test('error.discloses-no-path.example-scrub-is-positional-not-global', () => {
  const row1Value = `field: probe\naccepted: probe\nexample: ${SENTINEL_POSIX}\nretryable: true\nprobe was refused; unrelated message text with no path.`
  assert.doesNotThrow(() =>
    census([{ path: 'content[0].text', value: row1Value, declaredExample: SENTINEL_POSIX }], classifyEmittedPath)
  )

  const row2Value = `field: probe\naccepted: probe\nexample: ${SENTINEL_POSIX}\nretryable: true\nprobe was refused; it accepts probe; a valid example is ${SENTINEL_POSIX}; retryable=true.`
  assert.doesNotThrow(() =>
    census([{ path: 'content[0].text', value: row2Value, declaredExample: SENTINEL_POSIX }], classifyEmittedPath)
  )

  const row3Value = `field: probe\naccepted: probe\nexample: /\nretryable: true\nprobe was refused; the real leaked path is ${SENTINEL_POSIX}; retryable=true.`
  assert.throws(() =>
    census([{ path: 'content[0].text', value: row3Value, declaredExample: '/' }], classifyEmittedPath)
  )

  const row4Value = `field: probe\naccepted: probe\nexample: chmod +r <dir>\nretryable: true\nprobe was refused; the real leaked path is ${SENTINEL_POSIX}; retryable=true.`
  assert.throws(() =>
    census([{ path: 'content[0].text', value: row4Value, declaredExample: 'chmod +r <dir>' }], classifyEmittedPath)
  )
})

test('error.discloses-no-path.with-detail-is-idempotent', () => {
  const original = refusalTemplate()
  const snapshot = JSON.stringify(original)

  const once = withDetail(original, 'first detail')
  assert.doesNotThrow(() => withDetail(once, 'second detail'))
  const twice = withDetail(once, 'second detail')

  assert.equal(JSON.stringify(original), snapshot)
  assert.notEqual(original, once)
  assert.notEqual(once, twice)
  assert.equal(Object.getOwnPropertyDescriptor(twice, 'detail')?.value, 'first detail | second detail')
})
