import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Refusal } from '../../src/schema/declare.ts'
import { toolRefusal } from '../../src/server/errors.ts'
import { git, type Identity } from '../../src/store/git.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { LEDGER_REF, casUpdateRef } from '../../src/store/ref.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import {
  SENTINEL_POSIX,
  SENTINEL_TOKEN,
  SENTINEL_WIN32,
  classifyEmittedPath,
  emittedStrings,
  refusalTemplate,
  taintRefusal
} from '../support/refusal-census.ts'
import type { EmittedString } from '../support/refusal-census.ts'

const collectRealRefusals = (): Refusal[] => {
  const refusals: Refusal[] = [refusalTemplate()]

  const noPluginDataDir = mkdtempSync(join(tmpdir(), 'logbook-no-plugin-data-'))
  try {
    const rt = testRuntime({ env: {} })
    const result = layoutFor(rt, noPluginDataDir)
    if (result.ok) throw new Error('expected layoutFor to refuse when CLAUDE_PLUGIN_DATA is unset')
    refusals.push(result)
  } finally {
    rmSync(noPluginDataDir, { recursive: true, force: true })
  }

  const pluginDataRoot = mkdtempSync(join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const missingPath = join(pluginDataRoot, 'does-not-exist', 'nested')
    const result = layoutFor(rt, missingPath)
    if (result.ok) throw new Error('expected layoutFor to refuse on a missing projectRoot')
    refusals.push(result)
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
    refusals.push(mismatch)
  })

  const nonGitDir = mkdtempSync(join(tmpdir(), 'logbook-non-git-'))
  try {
    const rt = testRuntime()
    const ioFailure = casUpdateRef(rt, nonGitDir, LEDGER_REF, '1'.repeat(40), null)
    if (ioFailure.ok) throw new Error('expected an io refusal against a non-git directory')
    refusals.push(ioFailure)
  } finally {
    rmSync(nonGitDir, { recursive: true, force: true })
  }

  return refusals
}

test('error.discloses-no-path', () => {
  const refusals = collectRealRefusals()
  assert.ok(refusals.length > 0, 'expected at least one forced refusal to census')

  const emitted = refusals.flatMap((r) => emittedStrings(toolRefusal(r)))
  assert.ok(emitted.length > 0, 'expected the rendered refusals to carry emitted strings')
  assert.doesNotThrow(() => census(emitted, classifyEmittedPath))

  const forbiddenPosix: EmittedString[] = [{ path: 'synthetic', value: `leaked at ${SENTINEL_POSIX}` }]
  assert.throws(() => census(forbiddenPosix, classifyEmittedPath))

  const forbiddenWin32: EmittedString[] = [{ path: 'synthetic', value: `leaked at ${SENTINEL_WIN32}` }]
  assert.throws(() => census(forbiddenWin32, classifyEmittedPath))

  const template = refusalTemplate()
  const knownKeys = new Set(Object.keys(template))
  const classifyRefusalKey = (key: string): Classified<string>['verdict'] | 'unclassifiable' =>
    knownKeys.has(key) ? 'allowed' : 'unclassifiable'
  assert.doesNotThrow(() => census(Object.keys(taintRefusal(template, SENTINEL_TOKEN)), classifyRefusalKey))
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
  const classifyRefusalKey = (key: string): Classified<string>['verdict'] | 'unclassifiable' =>
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
  assert.doesNotThrow(() => census(emittedStrings(withStrip), classifyEmittedPath))
  assert.equal(
    emittedStrings(withStrip).some((s) => s.value.includes(SENTINEL_TOKEN)),
    false
  )

  const withoutStrip: CallToolResult = {
    isError: true,
    content: [{ type: 'text', text: leaky.message }],
    structuredContent: { ...leaky }
  }
  assert.throws(() => census(emittedStrings(withoutStrip), classifyEmittedPath))
})
