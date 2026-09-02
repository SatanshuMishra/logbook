import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardDecision } from '../../src/hooklib/guard.ts'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'
import { freshPluginDataDir, freshTmpDir } from './hook-process.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'

const LEDGER_TOOL_PREFIXES = ['mcp__ledger__', 'mcp__plugin_logbook_ledger__'] as const

const LEDGER_SUFFIX_SEPARATOR = 'ledger__'

const NON_REGISTERED_LEDGER_TOOL_NAMES = [
  'mcp__ledger__read_decision',
  'mcp__plugin_logbook_ledger__read_decision',
  'mcp__ledger__get_resume_brief',
  'mcp__plugin_logbook_ledger__get_resume_brief',
  'mcp__ledger__rebuild_index',
  'mcp__plugin_logbook_ledger__rebuild_index',
  'mcp__ledger__reconcile',
  'mcp__plugin_logbook_ledger__reconcile',
  'mcp__ledger__drop_database',
  'mcp__ledger__exec',
  'mcp__plugin_logbook_ledger__exec',
  'mcp__plugin_session-continuity_ledger__exec',
  'mcp__ledger__',
  'mcp__ledger__open_thread_extra'
] as const

const storedRuntime = (label: string): { rt: Runtime; projectRoot: string } => {
  const projectRoot = freshTmpDir(`logbook-guard-registry-${label}-project-`)
  const pluginDataRoot = freshPluginDataDir(`logbook-guard-registry-${label}-plugin-data-`).root
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })
  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)
  return { rt, projectRoot }
}

const suffixOf = (toolName: string): string =>
  toolName.slice(toolName.lastIndexOf(LEDGER_SUFFIX_SEPARATOR) + LEDGER_SUFFIX_SEPARATOR.length)

test('hook.guard.registry.every-registered-tool-is-auto-approved-in-both-prefix-forms', () => {
  const { rt, projectRoot } = storedRuntime('approved')
  assert.ok(ALL_TOOLS.length > 0, 'expected the production registry to carry at least one tool')

  for (const tool of ALL_TOOLS) {
    for (const prefix of LEDGER_TOOL_PREFIXES) {
      const toolName = `${prefix}${tool.name}`
      const verdict = guardDecision(rt, { tool_name: toolName, tool_input: {}, cwd: projectRoot })
      assert.equal(
        verdict.kind,
        'allow',
        `expected the registered ledger tool ${toolName} to be auto-approved, got ${JSON.stringify(verdict)}`
      )
    }
  }
})

test('hook.guard.registry.a-prefixed-name-that-is-not-registered-is-not-approved', () => {
  const { rt, projectRoot } = storedRuntime('unregistered')
  const registeredNames = ALL_TOOLS.map((tool) => tool.name)
  assert.ok(NON_REGISTERED_LEDGER_TOOL_NAMES.length > 0, 'expected a non-empty set of non-registered names to drive')

  for (const toolName of NON_REGISTERED_LEDGER_TOOL_NAMES) {
    assert.ok(
      !registeredNames.includes(suffixOf(toolName)),
      `expected ${toolName} to name no registered tool, but ${suffixOf(toolName)} is registered; this list no longer censuses what it claims`
    )
    const verdict = guardDecision(rt, { tool_name: toolName, tool_input: {}, cwd: projectRoot })
    assert.notEqual(
      verdict.kind,
      'allow',
      `expected the unregistered ledger-prefixed name ${toolName} not to be auto-approved, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.registry.an-unresolvable-store-does-not-auto-approve-an-unregistered-name', () => {
  const projectRoot = freshTmpDir('logbook-guard-registry-unset-project-')
  const rt = testRuntime({ env: {}, cwd: projectRoot })
  const verdict = guardDecision(rt, {
    tool_name: 'mcp__ledger__totally_made_up',
    tool_input: {},
    cwd: projectRoot
  })
  assert.notEqual(
    verdict.kind,
    'allow',
    `expected an unregistered ledger-prefixed name to be refused auto-approval with no store configured, got ${JSON.stringify(verdict)}`
  )
})
