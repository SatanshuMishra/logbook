import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { guardDecision } from '../../src/hooklib/guard.ts'
import type { GuardVerdict } from '../../src/hooklib/guard.ts'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { testRuntime } from '../support/runtime.ts'
import { freshPluginDataDir, freshTmpDir } from './hook-process.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'

type Fixture = { rt: Runtime; projectRoot: string; storeRoot: string }

const fixture = (label: string): Fixture => {
  const projectRoot = freshTmpDir(`logbook-guard-mode-${label}-project-`)
  const pluginDataRoot = freshPluginDataDir(`logbook-guard-mode-${label}-plugin-data-`).root
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })
  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)
  return { rt, projectRoot, storeRoot: layout.value.root }
}

const STORE_WRITE_COMMAND = `git update-ref ${LEDGER_REF} deadbeef`

const bashUnderMode = (fix: Fixture, permission_mode: unknown): GuardVerdict =>
  guardDecision(fix.rt, {
    tool_name: 'Bash',
    tool_input: { command: STORE_WRITE_COMMAND },
    cwd: fix.projectRoot,
    permission_mode
  })

const bashWithNoModeField = (fix: Fixture): GuardVerdict =>
  guardDecision(fix.rt, {
    tool_name: 'Bash',
    tool_input: { command: STORE_WRITE_COMMAND },
    cwd: fix.projectRoot
  })

const writeIntoStoreUnderMode = (fix: Fixture, permission_mode: unknown): GuardVerdict =>
  guardDecision(fix.rt, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(fix.storeRoot, 'records', 'sneaked-in.json') },
    cwd: fix.projectRoot,
    permission_mode
  })

const MODES_THAT_OPTED_OUT_OF_PROMPTS: readonly string[] = ['bypassPermissions']

const MODES_THAT_DID_NOT_OPT_OUT: readonly string[] = [
  'default',
  'plan',
  'acceptEdits',
  'dontAsk',
  'auto',
  'bubble',
  'Default',
  'BYPASSPERMISSIONS',
  'bypasspermissions',
  'bypassPermissions ',
  'dont-ask',
  ''
]

const NON_STRING_MODES: readonly unknown[] = [1, 0, true, false, null, {}, ['bypassPermissions']]

test('hook.guard.permission-mode.the-reproduction-command-prompts-under-the-default-mode', () => {
  const fix = fixture('baseline')
  const verdict = bashUnderMode(fix, 'default')
  assert.equal(
    verdict.kind,
    'ask',
    `expected ${JSON.stringify(STORE_WRITE_COMMAND)} to prompt under the default mode, so that the mode is the only variable in this file, got ${JSON.stringify(verdict)}`
  )
})

test('hook.guard.permission-mode.a-mode-that-already-opted-out-of-prompts-stops-the-prompt', () => {
  const fix = fixture('permissive')
  assert.ok(
    MODES_THAT_OPTED_OUT_OF_PROMPTS.length > 0,
    'expected a non-empty population of permissive modes to drive this assertion'
  )

  for (const mode of MODES_THAT_OPTED_OUT_OF_PROMPTS) {
    const verdict = bashUnderMode(fix, mode)
    assert.equal(
      verdict.kind,
      'silent',
      `expected permission_mode ${JSON.stringify(mode)} to stop the Bash prompt, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.permission-mode.every-other-mode-still-prompts', () => {
  const fix = fixture('prompting')
  assert.ok(
    MODES_THAT_DID_NOT_OPT_OUT.length > 0 && NON_STRING_MODES.length > 0,
    'expected non-empty populations of non-permissive modes to drive this assertion'
  )

  for (const mode of MODES_THAT_DID_NOT_OPT_OUT) {
    const verdict = bashUnderMode(fix, mode)
    assert.equal(
      verdict.kind,
      'ask',
      `expected permission_mode ${JSON.stringify(mode)} to keep prompting, got ${JSON.stringify(verdict)}`
    )
  }

  for (const mode of NON_STRING_MODES) {
    const verdict = bashUnderMode(fix, mode)
    assert.equal(
      verdict.kind,
      'ask',
      `expected the non-string permission_mode ${JSON.stringify(mode)} to keep prompting, got ${JSON.stringify(verdict)}`
    )
  }

  const absent = bashWithNoModeField(fix)
  assert.equal(
    absent.kind,
    'ask',
    `expected an event carrying no permission_mode field to keep prompting, got ${JSON.stringify(absent)}`
  )
})

test('hook.guard.permission-mode.no-mode-unblocks-a-write-into-the-store', () => {
  const fix = fixture('write-still-denied')
  const everyMode: readonly unknown[] = [
    ...MODES_THAT_OPTED_OUT_OF_PROMPTS,
    ...MODES_THAT_DID_NOT_OPT_OUT,
    ...NON_STRING_MODES
  ]
  assert.ok(everyMode.length > 0, 'expected a non-empty population of modes to drive this assertion')

  for (const mode of everyMode) {
    const verdict = writeIntoStoreUnderMode(fix, mode)
    assert.equal(
      verdict.kind,
      'deny',
      `expected a Write into the store to stay denied under permission_mode ${JSON.stringify(mode)}, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.permission-mode.a-mode-that-is-stricter-than-default-does-not-silence-the-guard', () => {
  const fix = fixture('stricter-than-default')
  const strictModes: readonly string[] = ['dontAsk', 'auto']

  for (const mode of strictModes) {
    const verdict = bashUnderMode(fix, mode)
    assert.equal(
      verdict.kind,
      'ask',
      `expected permission_mode ${JSON.stringify(mode)} to keep prompting, because it denies or classifies an unapproved call rather than skipping the prompt, so going silent would delete the guard's reason rather than a prompt nobody sees; got ${JSON.stringify(verdict)}`
    )
  }
})
