import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { guardDecision } from '../../src/hooklib/guard.ts'
import type { GuardVerdict } from '../../src/hooklib/guard.ts'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { testRuntime } from '../support/runtime.ts'
import { TREE_ROOT, freshPluginDataDir, freshTmpDir } from './hook-process.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'

type Fixture = { rt: Runtime; projectRoot: string; storeRoot: string }

const OPTION_KEY = 'disable_bash_guard'
const OPTION_ENV_KEY = 'CLAUDE_PLUGIN_OPTION_DISABLE_BASH_GUARD'

const fixture = (label: string, optionValue?: string): Fixture => {
  const projectRoot = freshTmpDir(`logbook-guard-option-${label}-project-`)
  const pluginDataRoot = freshPluginDataDir(`logbook-guard-option-${label}-plugin-data-`).root
  const optionEnv = optionValue === undefined ? {} : { [OPTION_ENV_KEY]: optionValue }
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot, ...optionEnv }, cwd: projectRoot })
  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)
  return { rt, projectRoot, storeRoot: layout.value.root }
}

const STORE_WRITE_COMMAND = `git update-ref ${LEDGER_REF} deadbeef`

const bashTouchingTheStore = (fix: Fixture): GuardVerdict =>
  guardDecision(fix.rt, {
    tool_name: 'Bash',
    tool_input: { command: STORE_WRITE_COMMAND },
    cwd: fix.projectRoot,
    permission_mode: 'default'
  })

const writeIntoTheStore = (fix: Fixture): GuardVerdict =>
  guardDecision(fix.rt, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(fix.storeRoot, 'records', 'sneaked-in.json') },
    cwd: fix.projectRoot,
    permission_mode: 'default'
  })

const VALUES_THAT_DO_NOT_TURN_THE_OPTION_ON: readonly string[] = ['false', 'False', 'TRUE', 'True', '1', 'yes', 'on', '']

type PluginManifest = {
  userConfig?: Record<string, { type?: unknown; title?: unknown; description?: unknown; default?: unknown }>
}

test('hook.guard.disable-option.the-manifest-declares-the-option-so-a-configured-value-can-reach-the-hook', () => {
  const manifestPath = path.join(TREE_ROOT, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest
  const declared = manifest.userConfig?.[OPTION_KEY]
  assert.notEqual(
    declared,
    undefined,
    `expected ${manifestPath} to declare userConfig.${OPTION_KEY}; without the declaration the CLI never sets ${OPTION_ENV_KEY} and the option cannot be honoured`
  )
  assert.equal(
    declared?.type,
    'boolean',
    `expected userConfig.${OPTION_KEY}.type to be "boolean", got ${JSON.stringify(declared?.type)}`
  )
})

test('hook.guard.disable-option.the-option-being-on-stops-a-bash-prompt-the-guard-would-otherwise-raise', () => {
  const off = fixture('control-absent')
  const control = bashTouchingTheStore(off)
  assert.equal(
    control.kind,
    'ask',
    `expected ${JSON.stringify(STORE_WRITE_COMMAND)} to prompt with the option absent, so that the option is the only variable, got ${JSON.stringify(control)}`
  )

  const on = fixture('on', 'true')
  const verdict = bashTouchingTheStore(on)
  assert.equal(
    verdict.kind,
    'silent',
    `expected ${OPTION_ENV_KEY}="true" to stop the Bash prompt, got ${JSON.stringify(verdict)}`
  )
})

test('hook.guard.disable-option.anything-other-than-the-string-true-leaves-the-guard-prompting', () => {
  assert.ok(
    VALUES_THAT_DO_NOT_TURN_THE_OPTION_ON.length > 0,
    'expected a non-empty population of non-enabling option values to drive this assertion'
  )

  for (const value of VALUES_THAT_DO_NOT_TURN_THE_OPTION_ON) {
    const fix = fixture(`off-${value.length}-${value.toLowerCase()}`, value)
    const verdict = bashTouchingTheStore(fix)
    assert.equal(
      verdict.kind,
      'ask',
      `expected ${OPTION_ENV_KEY}=${JSON.stringify(value)} to leave the guard prompting, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.disable-option.the-option-being-on-does-not-unblock-a-write-into-the-store', () => {
  const on = fixture('write-still-denied', 'true')
  const verdict = writeIntoTheStore(on)
  assert.equal(
    verdict.kind,
    'deny',
    `expected a Write into the store to stay denied with ${OPTION_ENV_KEY}="true", got ${JSON.stringify(verdict)}`
  )
})
