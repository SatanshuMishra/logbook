import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'
import { spawnServer } from '../support/spawn-client.ts'
import { readFixture } from '../hooks/hook-process.ts'

const REPO_ROOT_MARKER = path.join('.claude-plugin', 'plugin.json')
const REPO_ROOT_MAX_ASCENT = 10

const EXPECTED_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd', 'Stop'] as const
type HookEventName = (typeof EXPECTED_EVENTS)[number]

const EXPECTED_POPULATION_SIZE = 7

const HOOKS_JSON_COMMAND_PATTERN = /^node "\$\{CLAUDE_PLUGIN_ROOT\}(\/[A-Za-z0-9._\/-]+)"$/
const MCP_ARG_PATTERN = /^\$\{CLAUDE_PLUGIN_ROOT\}(\/[A-Za-z0-9._\/-]+)$/

const FIXTURE_FILE_FOR_EVENT: Record<HookEventName, string> = {
  SessionStart: 'session-start.startup.json',
  UserPromptSubmit: 'user-prompt-submit.json',
  PreToolUse: 'pre-tool-use.json',
  PostToolUse: 'post-tool-use.json',
  SessionEnd: 'session-end.other.json',
  Stop: 'stop.json'
}

const POPULATION_SCOPE_NOTE =
  'the population covers command and args positions only; env values, matcher regexes and timeout numbers are out of scope, and this key-set guard is what keeps that scope honest'

type HookCommandItem = {
  source: string
  kind: 'hook'
  hookName: HookEventName
  rawTarget: string
  absoluteTarget: string | null
}

type McpCommandItem = {
  source: string
  kind: 'mcp-server'
  hookName: string
  rawTarget: string
  absoluteTarget: string | null
}

type ManifestCommandItem = HookCommandItem | McpCommandItem

class RepoRootNotFoundError extends Error {
  constructor(startDir: string) {
    super(`RepoRootNotFoundError: walked up from ${startDir} without finding an ancestor containing ${REPO_ROOT_MARKER}`)
    this.name = 'RepoRootNotFoundError'
  }
}

const resolveRepoRoot = (): string => {
  const startDir = path.dirname(fileURLToPath(import.meta.url))
  let dir = startDir
  for (let step = 0; step < REPO_ROOT_MAX_ASCENT; step += 1) {
    if (existsSync(path.join(dir, REPO_ROOT_MARKER))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new RepoRootNotFoundError(startDir)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJsonFile = (filePath: string): unknown => JSON.parse(readFileSync(filePath, 'utf8'))

const describeRaw = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const extractHookCommand = (
  repoRoot: string,
  event: HookEventName,
  hooksField: Record<string, unknown>
): HookCommandItem => {
  const bindings = hooksField[event]
  if (!Array.isArray(bindings)) {
    throw new Error(`cutover.manifest-commands: hooks.${event} is not an array in hooks.json`)
  }
  assert.strictEqual(bindings.length, 1, `hooks.${event} binding array has length ${bindings.length}, expected exactly 1`)
  const binding: unknown = bindings[0]
  if (!isRecord(binding)) {
    throw new Error(`cutover.manifest-commands: hooks.${event}[0] is not an object`)
  }
  const hooksArray = binding.hooks
  if (!Array.isArray(hooksArray)) {
    throw new Error(`cutover.manifest-commands: hooks.${event}[0].hooks is not an array in hooks.json`)
  }
  assert.strictEqual(
    hooksArray.length,
    1,
    `hooks.${event}[0].hooks array has length ${hooksArray.length}, expected exactly 1`
  )
  const commandEntry: unknown = hooksArray[0]
  if (!isRecord(commandEntry) || typeof commandEntry.command !== 'string') {
    throw new Error(`cutover.manifest-commands: hooks.${event}[0].hooks[0] has no string "command" field`)
  }
  const command = commandEntry.command
  const matched = HOOKS_JSON_COMMAND_PATTERN.exec(command)
  const capturedPath = matched?.[1]
  const absoluteTarget = capturedPath === undefined ? null : path.join(repoRoot, capturedPath)
  return { source: `hooks.json#${event}`, kind: 'hook', hookName: event, rawTarget: command, absoluteTarget }
}

const extractMcpCommand = (repoRoot: string, name: string, def: unknown): McpCommandItem => {
  const source = `.mcp.json#${name}`
  if (!isRecord(def)) {
    return { source, kind: 'mcp-server', hookName: name, rawTarget: describeRaw(def), absoluteTarget: null }
  }
  const command = def.command
  const args = def.args
  const rawTarget = describeRaw({ command, args })
  if (command !== 'node' || !Array.isArray(args)) {
    return { source, kind: 'mcp-server', hookName: name, rawTarget, absoluteTarget: null }
  }
  if (args.length !== 1) {
    return { source, kind: 'mcp-server', hookName: name, rawTarget, absoluteTarget: null }
  }
  const firstArg: unknown = args[0]
  if (typeof firstArg !== 'string') {
    return { source, kind: 'mcp-server', hookName: name, rawTarget, absoluteTarget: null }
  }
  const matched = MCP_ARG_PATTERN.exec(firstArg)
  const capturedPath = matched?.[1]
  const absoluteTarget = capturedPath === undefined ? null : path.join(repoRoot, capturedPath)
  return { source, kind: 'mcp-server', hookName: name, rawTarget, absoluteTarget }
}

const buildPopulation = (repoRoot: string): ManifestCommandItem[] => {
  const hooksJsonPath = path.join(repoRoot, 'hooks', 'hooks.json')
  const hooksJson = readJsonFile(hooksJsonPath)
  if (!isRecord(hooksJson)) {
    throw new Error(`cutover.manifest-commands: ${hooksJsonPath} did not parse to a JSON object`)
  }
  const hooksField = hooksJson.hooks
  if (!isRecord(hooksField)) {
    throw new Error(`cutover.manifest-commands: ${hooksJsonPath} has no "hooks" object field`)
  }
  const actualEventKeys = Object.keys(hooksField).sort()
  const expectedEventKeys = [...EXPECTED_EVENTS].sort()
  assert.deepStrictEqual(
    actualEventKeys,
    expectedEventKeys,
    `${hooksJsonPath} declares hook events ${JSON.stringify(actualEventKeys)}, expected exactly ${JSON.stringify(
      expectedEventKeys
    )}. ${POPULATION_SCOPE_NOTE}`
  )

  const hookItems = EXPECTED_EVENTS.map((event) => extractHookCommand(repoRoot, event, hooksField))

  const mcpJsonPath = path.join(repoRoot, '.mcp.json')
  const mcpJson = readJsonFile(mcpJsonPath)
  if (!isRecord(mcpJson)) {
    throw new Error(`cutover.manifest-commands: ${mcpJsonPath} did not parse to a JSON object`)
  }
  const mcpServers = mcpJson.mcpServers
  if (!isRecord(mcpServers)) {
    throw new Error(`cutover.manifest-commands: ${mcpJsonPath} has no "mcpServers" object field`)
  }
  const mcpItems = Object.entries(mcpServers).map(([name, def]) => extractMcpCommand(repoRoot, name, def))

  return [...hookItems, ...mcpItems]
}

const classifyResolution = (item: ManifestCommandItem): Classified<ManifestCommandItem>['verdict'] | 'unclassifiable' => {
  if (item.absoluteTarget === null) return 'unclassifiable'
  if (!existsSync(item.absoluteTarget)) return 'forbidden'
  return statSync(item.absoluteTarget).isFile() ? 'allowed' : 'forbidden'
}

const describeViolations = (items: ManifestCommandItem[]): string => {
  const violations = items
    .map((item) => ({ item, verdict: classifyResolution(item) }))
    .filter(({ verdict }) => verdict !== 'allowed')
    .map(({ item, verdict }) => `${item.source} (${verdict}): ${item.absoluteTarget ?? item.rawTarget}`)
  return violations.length === 0 ? 'no violations' : `manifest command violations: ${violations.join('; ')}`
}

const classifyHooksJsonCommandShape = (command: string): 'parses' | 'unclassifiable' =>
  HOOKS_JSON_COMMAND_PATTERN.test(command) ? 'parses' : 'unclassifiable'

const classifyControlCommand = (command: string): Classified<string>['verdict'] | 'unclassifiable' =>
  classifyHooksJsonCommandShape(command) === 'parses' ? 'allowed' : 'unclassifiable'

test('cutover.manifest-commands-resolve', () => {
  const repoRoot = resolveRepoRoot()
  const population = buildPopulation(repoRoot)
  assert.ok(population.length > 0, 'expected at least one manifest-derived command')
  assert.strictEqual(
    population.length,
    EXPECTED_POPULATION_SIZE,
    `expected exactly ${EXPECTED_POPULATION_SIZE} manifest-derived commands, found ${population.length}: ${population
      .map((item) => item.source)
      .join(', ')}`
  )
  assert.doesNotThrow(() => census(population, classifyResolution), describeViolations(population))
})

test('cutover.manifest-commands-execute', async () => {
  const repoRoot = resolveRepoRoot()
  const population = buildPopulation(repoRoot)

  const hookItems = population.filter((item): item is HookCommandItem => item.kind === 'hook')
  for (const item of hookItems) {
    if (item.absoluteTarget === null) {
      assert.fail(`${item.source}: command ${JSON.stringify(item.rawTarget)} does not match the closed hooks.json pattern`)
    }
    const event = readFixture(FIXTURE_FILE_FOR_EVENT[item.hookName])
    const homeDir = mkdtempSync(path.join(tmpdir(), 'logbook-manifest-exec-home-'))
    const pluginData = mkdtempSync(path.join(tmpdir(), 'logbook-manifest-exec-data-'))
    try {
      const result = spawnSync(process.execPath, [item.absoluteTarget], {
        input: JSON.stringify(event),
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', HOME: homeDir, CLAUDE_PLUGIN_DATA: pluginData }
      })
      assert.strictEqual(result.status, 0, `${item.source} exited ${result.status}; stderr: ${result.stderr}`)
      const parsed: unknown = JSON.parse(result.stdout)
      assert.strictEqual(typeof parsed, 'object')
      assert.notStrictEqual(parsed, null)
      assert.strictEqual(Array.isArray(parsed), false)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(pluginData, { recursive: true, force: true })
    }
  }

  const mcpItems = population.filter((item): item is McpCommandItem => item.kind === 'mcp-server')
  for (const item of mcpItems) {
    if (item.absoluteTarget === null) {
      assert.fail(`${item.source}: command does not match the closed .mcp.json pattern`)
    }
    const spawned = await spawnServer({ projectRoot: repoRoot, entry: item.absoluteTarget })
    try {
      assert.notStrictEqual(spawned.client.getServerVersion(), undefined)
      const listed = await spawned.client.listTools()
      assert.ok(listed.tools.length > 0, `${item.source}: expected at least one tool, found 0`)
    } finally {
      await spawned.close()
    }
  }
})

test('cutover.manifest-commands-resolve.control.an-unparseable-command-halts-the-census', () => {
  const PARSES = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.ts"'
  const WRONG_INTERPRETER = 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'
  const WRONG_VARIABLE = 'node "${SOME_OTHER_VAR}/hooks/session-start.ts"'

  assert.strictEqual(classifyHooksJsonCommandShape(PARSES), 'parses')
  assert.strictEqual(classifyHooksJsonCommandShape(WRONG_INTERPRETER), 'unclassifiable')
  assert.strictEqual(classifyHooksJsonCommandShape(WRONG_VARIABLE), 'unclassifiable')

  assert.throws(
    () => census([PARSES, WRONG_INTERPRETER, WRONG_VARIABLE], classifyControlCommand),
    (thrown: unknown): boolean => thrown instanceof Error && thrown.message.includes(JSON.stringify(WRONG_INTERPRETER))
  )
})
