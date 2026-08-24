import { test } from 'node:test'
import assert from 'node:assert/strict'
import { symlinkSync } from 'node:fs'
import path from 'node:path'
import { guardDecision } from '../../src/hooklib/guard.ts'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'
import { freshTmpDir } from './hook-process.ts'

test('hook.guard.denies-symlinked-store', () => {
  const projectRoot = freshTmpDir('logbook-guard-symlink-project-')
  const pluginDataRoot = freshTmpDir('logbook-guard-symlink-plugin-data-')
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })

  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)

  const aliasParent = freshTmpDir('logbook-guard-symlink-alias-parent-')
  const aliasPath = path.join(aliasParent, 'store-alias')
  symlinkSync(layout.value.root, aliasPath)

  const targetThroughSymlink = path.join(aliasPath, 'records', 'sneaked-in.json')
  const writeThroughSymlink = guardDecision(rt, {
    tool_name: 'Write',
    tool_input: { file_path: targetThroughSymlink },
    cwd: projectRoot
  })
  assert.equal(
    writeThroughSymlink.kind,
    'deny',
    `expected a write reached through a symlink into the store to be denied, got ${JSON.stringify(writeThroughSymlink)}`
  )

  const directTarget = path.join(layout.value.root, 'records', 'direct.json')
  const writeDirect = guardDecision(rt, {
    tool_name: 'Write',
    tool_input: { file_path: directTarget },
    cwd: projectRoot
  })
  assert.equal(writeDirect.kind, 'deny', 'expected a write directly into the store to be denied')

  const harmlessTarget = path.join(projectRoot, 'unrelated-file.txt')
  const writeHarmless = guardDecision(rt, {
    tool_name: 'Write',
    tool_input: { file_path: harmlessTarget },
    cwd: projectRoot
  })
  assert.equal(
    writeHarmless.kind,
    'silent',
    'expected a write outside the store, through no symlink, to pass through silently'
  )
})

test('hook.guard.denies-symlinked-store.canonicalisation-failure-refuses-rather-than-narrows', () => {
  const projectRoot = freshTmpDir('logbook-guard-unresolvable-project-')
  const pluginDataParent = freshTmpDir('logbook-guard-unresolvable-plugin-data-parent-')
  const loopPath = path.join(pluginDataParent, 'self-loop')
  symlinkSync(loopPath, loopPath)

  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: loopPath }, cwd: projectRoot })

  const writeVerdict = guardDecision(rt, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(projectRoot, 'whatever.json') },
    cwd: projectRoot
  })
  assert.equal(
    writeVerdict.kind,
    'deny',
    `expected a write to be denied when the store root cannot be canonicalised, got ${JSON.stringify(writeVerdict)}`
  )

  const bashVerdict = guardDecision(rt, {
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
    cwd: projectRoot
  })
  assert.equal(
    bashVerdict.kind,
    'ask',
    `expected an unresolvable store root to make Bash ask rather than silently allow, got ${JSON.stringify(bashVerdict)}`
  )
})
