import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { layoutFor } from '../../src/store/layout.ts'
import type { StoreLayout } from '../../src/store/layout.ts'
import { ensureSingleStore } from '../../src/store/single-store.ts'
import { testRuntime } from '../support/runtime.ts'

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const writeOrigin = (pluginDataRoot: string, key: string, projectRoot: string): void => {
  const stateDir = path.join(pluginDataRoot, key, 'state')
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, 'origin.json'), JSON.stringify({ project_root: projectRoot }), 'utf8')
}

test('store.refuses-a-second-store', () => {
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-single-store-'))
  try {
    const projectRoot = '/tmp/some/shared/project'
    writeOrigin(pluginDataRoot, 'store-key-a', projectRoot)
    writeOrigin(pluginDataRoot, 'store-key-b', projectRoot)

    const layout: StoreLayout = {
      root: path.join(pluginDataRoot, 'store-key-a'),
      records: path.join(pluginDataRoot, 'store-key-a', 'records'),
      state: path.join(pluginDataRoot, 'store-key-a', 'state'),
      projectRoot
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, false)
    if (result.ok) {
      throw new Error('expected a refusal')
    }
    assert.equal(result.retryable, false)
    assert.match(result.message, /store-key-a/)
    assert.match(result.message, /store-key-b/)
    assert.doesNotMatch(result.message, new RegExp(escapeRegExp(pluginDataRoot)))
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('store.single-store-with-no-sibling-is-ok', () => {
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-single-store-'))
  try {
    const projectRoot = '/tmp/only/one/project'
    writeOrigin(pluginDataRoot, 'store-key-only', projectRoot)

    const layout: StoreLayout = {
      root: path.join(pluginDataRoot, 'store-key-only'),
      records: path.join(pluginDataRoot, 'store-key-only', 'records'),
      state: path.join(pluginDataRoot, 'store-key-only', 'state'),
      projectRoot
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, true)
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('layout.refuses-when-plugin-data-unset', () => {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'logbook-project-'))
  try {
    const rt = testRuntime({ env: {} })
    const result = layoutFor(rt, projectDir)

    assert.equal(result.ok, false)
    if (result.ok) {
      throw new Error('expected a refusal')
    }
    assert.equal(result.field, 'CLAUDE_PLUGIN_DATA')
    assert.equal(result.retryable, true)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('layout.refuses-on-canonicalisation-failure', () => {
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const missingPath = path.join(pluginDataRoot, 'does-not-exist', 'nested')
    const result = layoutFor(rt, missingPath)

    assert.equal(result.ok, false)
    if (result.ok) {
      throw new Error('expected a refusal')
    }
    assert.equal(result.field, 'projectRoot')
    assert.equal(result.retryable, true)
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('layout.creates-records-and-state-directories', () => {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'logbook-project-'))
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const result = layoutFor(rt, projectDir)

    assert.equal(result.ok, true)
    if (!result.ok) {
      throw new Error('expected success')
    }
    assert.equal(existsSync(result.value.records), true)
    assert.equal(existsSync(result.value.state), true)
    const originPath = path.join(result.value.state, 'origin.json')
    assert.equal(existsSync(originPath), true)
    const origin = JSON.parse(readFileSync(originPath, 'utf8')) as { project_root: string }
    assert.equal(origin.project_root, result.value.projectRoot)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('layout.same-project-root-yields-same-layout', () => {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'logbook-project-'))
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const first = layoutFor(rt, projectDir)
    const second = layoutFor(rt, projectDir)

    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) {
      throw new Error('expected success')
    }
    assert.deepEqual(first.value, second.value)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})
