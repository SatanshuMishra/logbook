import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createStoreDirectories, layoutFor } from '../../src/store/layout.ts'
import type { StoreLayout } from '../../src/store/layout.ts'
import { ensureSingleStore } from '../../src/store/single-store.ts'
import { openStore } from '../../src/store/records.ts'
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

test('store.refuses-a-second-store-under-another-plugin-data-root', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-cross-root-'))
  try {
    const projectRoot = '/tmp/some/shared/project'
    const sharedKey = 'store-key-shared'
    writeOrigin(path.join(pluginDataParent, 'install-a'), sharedKey, projectRoot)
    writeOrigin(path.join(pluginDataParent, 'install-b'), sharedKey, projectRoot)

    const layout: StoreLayout = {
      root: path.join(pluginDataParent, 'install-a', sharedKey),
      records: path.join(pluginDataParent, 'install-a', sharedKey, 'records'),
      state: path.join(pluginDataParent, 'install-a', sharedKey, 'state'),
      projectRoot
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, false, 'a second store for this project under another plugin-data root must be refused')
    if (result.ok) {
      throw new Error('expected a refusal')
    }
    assert.equal(result.retryable, false)
    assert.match(result.message, /install-b/)
    assert.match(result.message, new RegExp(escapeRegExp(sharedKey)))
    assert.doesNotMatch(result.message, new RegExp(escapeRegExp(pluginDataParent)))
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
  }
})

test('store.a-second-store-for-another-project-under-another-root-is-ok', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-cross-root-'))
  try {
    const sharedKey = 'store-key-shared'
    writeOrigin(path.join(pluginDataParent, 'install-a'), sharedKey, '/tmp/project/one')
    writeOrigin(path.join(pluginDataParent, 'install-b'), sharedKey, '/tmp/project/two')

    const layout: StoreLayout = {
      root: path.join(pluginDataParent, 'install-a', sharedKey),
      records: path.join(pluginDataParent, 'install-a', sharedKey, 'records'),
      state: path.join(pluginDataParent, 'install-a', sharedKey, 'state'),
      projectRoot: '/tmp/project/one'
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, true, 'a same-keyed store belonging to a different project must not be treated as a duplicate')
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
  }
})

test('store.a-symlinked-cross-root-candidate-is-not-followed', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-cross-root-'))
  try {
    const sharedKey = 'store-key-shared'
    const projectRoot = '/tmp/some/shared/project'
    writeOrigin(path.join(pluginDataParent, 'install-a'), sharedKey, projectRoot)
    mkdirSync(path.join(pluginDataParent, 'install-b'), { recursive: true })
    symlinkSync(
      path.join(pluginDataParent, 'install-a', sharedKey),
      path.join(pluginDataParent, 'install-b', sharedKey)
    )

    const layout: StoreLayout = {
      root: path.join(pluginDataParent, 'install-a', sharedKey),
      records: path.join(pluginDataParent, 'install-a', sharedKey, 'records'),
      state: path.join(pluginDataParent, 'install-a', sharedKey, 'state'),
      projectRoot
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, true, "a symlinked cross-root candidate must not be followed into the store's own root")
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
  }
})

test('store.first-open-runs-the-cross-root-check-before-own-root-exists', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-cross-root-'))
  try {
    const projectRoot = '/tmp/some/shared/project'
    const sharedKey = 'store-key-shared'
    writeOrigin(path.join(pluginDataParent, 'install-a'), sharedKey, projectRoot)

    const pluginDataRoot = path.join(pluginDataParent, 'install-b')
    const layout: StoreLayout = {
      root: path.join(pluginDataRoot, sharedKey),
      records: path.join(pluginDataRoot, sharedKey, 'records'),
      state: path.join(pluginDataRoot, sharedKey, 'state'),
      projectRoot
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(
      result.ok,
      false,
      'the very first open for a new install must still catch a sibling holding the same project'
    )
    if (result.ok) {
      throw new Error('expected a refusal')
    }
    assert.equal(result.retryable, false)
    assert.match(result.message, /install-a/)
    assert.doesNotMatch(result.message, new RegExp(escapeRegExp(pluginDataParent)))
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
  }
})

test('store.first-open-with-no-sibling-conflict-is-ok', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-cross-root-'))
  try {
    const projectRoot = '/tmp/only/one/first-open/project'
    const sharedKey = 'store-key-shared'
    writeOrigin(path.join(pluginDataParent, 'install-a'), sharedKey, '/tmp/a/different/project')

    const pluginDataRoot = path.join(pluginDataParent, 'install-b')
    const layout: StoreLayout = {
      root: path.join(pluginDataRoot, sharedKey),
      records: path.join(pluginDataRoot, sharedKey, 'records'),
      state: path.join(pluginDataRoot, sharedKey, 'state'),
      projectRoot
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(
      result.ok,
      true,
      'the first open for a new install must still succeed when no sibling holds this project'
    )
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
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
    assert.match(result.message, /ENOENT/)
    assert.doesNotMatch(result.message, new RegExp(escapeRegExp(missingPath)))
    assert.doesNotMatch(result.message, new RegExp(escapeRegExp(pluginDataRoot)))
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('store.plugin-data-listing-failure-is-path-free', () => {
  const pluginDataParent = mkdtempSync(path.join(tmpdir(), 'logbook-plugin-data-'))
  const notADirectory = path.join(pluginDataParent, 'not-a-directory')
  writeFileSync(notADirectory, 'not a directory', 'utf8')
  try {
    const layout: StoreLayout = {
      root: path.join(notADirectory, 'store-key'),
      records: path.join(notADirectory, 'store-key', 'records'),
      state: path.join(notADirectory, 'store-key', 'state'),
      projectRoot: '/tmp/some/project'
    }

    const rt = testRuntime()
    const result = ensureSingleStore(rt, layout)

    assert.equal(result.ok, false)
    if (result.ok) {
      throw new Error('expected a refusal')
    }
    assert.equal(result.retryable, true)
    assert.match(result.message, /ENOTDIR/)
    assert.doesNotMatch(result.message, new RegExp(escapeRegExp(notADirectory)))
  } finally {
    rmSync(pluginDataParent, { recursive: true, force: true })
  }
})

test('store.refusal-leaves-no-new-directory', () => {
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-single-store-'))
  const projectDir = mkdtempSync(path.join(tmpdir(), 'logbook-project-'))
  try {
    const canonicalProjectRoot = realpathSync.native(projectDir)
    writeOrigin(pluginDataRoot, 'store-key-existing', canonicalProjectRoot)

    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const before = readdirSync(pluginDataRoot).sort()

    const result = openStore(rt, projectDir)

    assert.equal(result.ok, false)
    if (result.ok) {
      throw new Error('expected a refusal')
    }

    const after = readdirSync(pluginDataRoot).sort()
    assert.deepEqual(after, before)
    assert.deepEqual(after, ['store-key-existing'])
  } finally {
    rmSync(pluginDataRoot, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('layout.computes-paths-without-creating-directories', () => {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'logbook-project-'))
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const result = layoutFor(rt, projectDir)

    assert.equal(result.ok, true)
    if (!result.ok) {
      throw new Error('expected success')
    }
    assert.equal(existsSync(result.value.root), false)
    assert.equal(existsSync(result.value.records), false)
    assert.equal(existsSync(result.value.state), false)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(pluginDataRoot, { recursive: true, force: true })
  }
})

test('layout.createStoreDirectories-materialises-the-layout', () => {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'logbook-project-'))
  const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-plugin-data-'))
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot } })
    const result = layoutFor(rt, projectDir)

    assert.equal(result.ok, true)
    if (!result.ok) {
      throw new Error('expected success')
    }

    createStoreDirectories(result.value)

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
