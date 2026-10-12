import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshPluginDataDir, freshTmpDir } from '../hooks/hook-process.ts'

const MAX_REPOSITORY_ROOT_ASCENTS = 10
const PLUGIN_MANIFEST_RELATIVE = path.join('.claude-plugin', 'plugin.json')
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

test('contract.hook-cost.bash-guard-sees-every-bash-command', () => {
  const bindings = readHooksDocument().hooks.PreToolUse
  assert.ok(Array.isArray(bindings) && bindings.length > 0, 'hooks.json has no PreToolUse binding')
  const matchesName = (binding: Binding, name: string): boolean =>
    typeof binding.matcher === 'string' && new RegExp(binding.matcher).test(name)
  const handlers = bindings.flatMap((binding) => binding.hooks ?? [])
  assert.deepEqual(
    handlers.filter((handler) => handler.if !== undefined).map((handler) => handler.if),
    [],
    'a PreToolUse handler carries an if rule, so Claude Code skips the guard for any command whose argv lacks its text, such as a write by redirect, heredoc or here-string'
  )
  const bashBindings = bindings.filter((binding) => matchesName(binding, 'Bash'))
  assert.equal(bashBindings.length, 1, 'exactly one PreToolUse binding must match Bash')
  for (const name of [...FILE_TOOL_NAMES, ...LEDGER_TOOL_NAMES]) {
    assert.ok(
      bashBindings.every((binding) => matchesName(binding, name)),
      `the binding that guards Bash must also guard ${name}, as one unconditional binding`
    )
  }
})

test('contract.hook-cost.guard-asks-for-store-writes-by-redirect-heredoc-and-here-string', async () => {
  const { guardDecision } = await import('../../src/hooklib/guard.ts')
  const { layoutFor, createStoreDirectories } = await import('../../src/store/layout.ts')
  const { testRuntime } = await import('../support/runtime.ts')
  const projectRoot = freshTmpDir('logbook-hook-cost-guard-project-')
  const pluginData = freshPluginDataDir('logbook-hook-cost-guard-data-')
  try {
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginData.root }, cwd: projectRoot })
    const layout = layoutFor(rt, projectRoot)
    if (!layout.ok) throw new Error(`layoutFor refused: ${layout.message}`)
    createStoreDirectories(layout.value)
    const records = path.join(layout.value.root, 'records')
    const verdictFor = (command: string): string =>
      guardDecision(rt, { tool_name: 'Bash', tool_input: { command }, cwd: projectRoot, permission_mode: 'default' }).kind
    for (const command of [
      `printf '{}' > ${records}/x.json`,
      `cat > ${records}/y.json <<'EOF'\n{}\nEOF`,
      "git update-ref --stdin <<< 'delete refs/logbook/ledger'"
    ]) {
      assert.equal(verdictFor(command), 'ask', `the guard must ask before ${JSON.stringify(command)}`)
    }
    assert.equal(verdictFor('ls'), 'silent', 'the guard stays silent for a command that does not touch the store')
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(pluginData.home, { recursive: true, force: true })
  }
})
