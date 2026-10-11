import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_REPOSITORY_ROOT_ASCENTS = 10
const PLUGIN_MANIFEST_RELATIVE = path.join('.claude-plugin', 'plugin.json')
const BASH_IF_RULES = ['Bash(*logbook*)', 'Bash(*CLAUDE_PLUGIN_DATA*)']
const FILE_TOOL_NAMES = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const LEDGER_TOOL_NAMES = [
  'mcp__ledger__resume_thread',
  'mcp__plugin_logbook_ledger__resume_thread',
  'mcp__ledger__record_decision',
  'mcp__plugin_logbook_ledger__record_decision'
]

type Handler = { type?: unknown; command?: unknown; timeout?: unknown; if?: unknown }
type Binding = { matcher?: string; hooks?: Handler[] }
type HooksDocument = { hooks: Record<string, Binding[]> }

const findRepositoryRoot = (startDir: string): string => {
  let current = startDir
  for (let ascent = 0; ascent <= MAX_REPOSITORY_ROOT_ASCENTS; ascent += 1) {
    if (existsSync(path.join(current, PLUGIN_MANIFEST_RELATIVE))) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`hook-cost.test: could not find ${PLUGIN_MANIFEST_RELATIVE} above ${startDir}`)
}

const REPO_ROOT = findRepositoryRoot(path.dirname(fileURLToPath(import.meta.url)))

const readHooksDocument = (): HooksDocument =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8')) as HooksDocument

test('contract.hook-cost.no-post-tool-use-hook-ships', () => {
  const document = readHooksDocument()
  assert.equal('PostToolUse' in document.hooks, false, 'hooks.json still binds PostToolUse')
  assert.equal(
    existsSync(path.join(REPO_ROOT, 'hooks', 'post-tool-use.ts')),
    false,
    'hooks/post-tool-use.ts still exists'
  )
  const result = spawnSync(process.execPath, ['scripts/check-packaging.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })
  assert.equal(
    result.status,
    0,
    `check-packaging exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
})

test('contract.hook-cost.bash-guard-runs-only-for-commands-naming-the-store', () => {
  const bindings = readHooksDocument().hooks.PreToolUse
  assert.ok(Array.isArray(bindings) && bindings.length > 0, 'hooks.json has no PreToolUse binding')

  const matchesName = (binding: Binding, name: string): boolean =>
    typeof binding.matcher === 'string' && new RegExp(binding.matcher).test(name)

  const bashBindings = bindings.filter((binding) => matchesName(binding, 'Bash'))
  assert.ok(bashBindings.length > 0, 'no PreToolUse binding matches Bash')
  for (const binding of bashBindings) {
    const handlers = binding.hooks ?? []
    assert.ok(handlers.length > 0, 'a Bash binding carries no handler')
    for (const handler of handlers) {
      assert.ok(
        typeof handler.if === 'string' && BASH_IF_RULES.includes(handler.if),
        `a handler that can match Bash carries if ${JSON.stringify(handler.if)}, expected one of ${JSON.stringify(BASH_IF_RULES)}`
      )
    }
  }
  const ifRulesBound = bashBindings.flatMap((binding) => (binding.hooks ?? []).map((handler) => handler.if))
  assert.deepEqual([...ifRulesBound].sort(), [...BASH_IF_RULES].sort())

  const unconditional = bindings.filter((binding) =>
    (binding.hooks ?? []).some((handler) => handler.if === undefined)
  )
  assert.ok(unconditional.length > 0, 'no PreToolUse binding runs without an if rule')
  for (const binding of unconditional) {
    assert.equal(
      (binding.hooks ?? []).every((handler) => handler.if === undefined),
      true,
      'a binding mixes handlers with and without an if rule'
    )
    assert.equal(matchesName(binding, 'Bash'), false, 'a handler without an if rule matches Bash')
    for (const name of [...FILE_TOOL_NAMES, ...LEDGER_TOOL_NAMES]) {
      assert.equal(matchesName(binding, name), true, `the unconditional binding does not match ${name}`)
    }
  }
})
