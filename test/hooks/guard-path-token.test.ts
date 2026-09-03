import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { guardDecision } from '../../src/hooklib/guard.ts'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'
import { freshPluginDataDir, freshTmpDir } from './hook-process.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'

type Fixture = { rt: Runtime; projectRoot: string }

const fixture = (label: string): Fixture => {
  const projectRoot = freshTmpDir(`logbook-guard-token-${label}-project-`)
  const pluginDataRoot = freshPluginDataDir(`logbook-guard-token-${label}-plugin-data-`).root
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })
  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)
  return { rt, projectRoot }
}

test('hook.guard.path-token.a-token-that-cannot-be-canonicalised-is-not-inside-the-store', () => {
  const fix = fixture('enotdir')
  writeFileSync(path.join(fix.projectRoot, 'package.json'), '{}\n')

  const commands = ['cat package.json/nope', 'rm -rf package.json/nope', 'tee package.json/nope']
  for (const command of commands) {
    const verdict = guardDecision(fix.rt, {
      tool_name: 'Bash',
      tool_input: { command },
      cwd: fix.projectRoot
    })
    assert.equal(
      verdict.kind,
      'silent',
      `expected ${JSON.stringify(command)}, which names no store path, to pass without a prompt, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.path-token.a-write-whose-target-cannot-be-canonicalised-is-still-denied', () => {
  const fix = fixture('write-enotdir')
  writeFileSync(path.join(fix.projectRoot, 'not-a-directory'), 'x\n')

  const verdict = guardDecision(fix.rt, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(fix.projectRoot, 'not-a-directory', 'child.json') },
    cwd: fix.projectRoot
  })
  assert.equal(
    verdict.kind,
    'deny',
    `expected a write whose target cannot be canonicalised to stay denied, got ${JSON.stringify(verdict)}`
  )
})
