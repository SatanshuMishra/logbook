import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type * as SessionStartEntry from '../../hooks/session-start.ts'
import type * as UserPromptSubmitEntry from '../../hooks/user-prompt-submit.ts'
import type * as PreToolUseEntry from '../../hooks/pre-tool-use.ts'
import type * as PostToolUseEntry from '../../hooks/post-tool-use.ts'
import type * as SessionEndEntry from '../../hooks/session-end.ts'
import type * as StopEntry from '../../hooks/stop.ts'

type HookEntryModules = {
  'session-start': typeof SessionStartEntry
  'user-prompt-submit': typeof UserPromptSubmitEntry
  'pre-tool-use': typeof PreToolUseEntry
  'post-tool-use': typeof PostToolUseEntry
  'session-end': typeof SessionEndEntry
  stop: typeof StopEntry
}

export type HookName = keyof HookEntryModules

export const EVENT_NAME_OF = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  'session-end': 'SessionEnd',
  stop: 'Stop'
} as const satisfies Record<HookName, string>

export const HOOK_NAMES: readonly HookName[] = Object.keys(EVENT_NAME_OF) as readonly HookName[]

const TREE_ROOT_MARKER = path.join('hooks', 'hooks.json')
const TREE_ROOT_MAX_ASCENT = 10

const findTreeRoot = (): string => {
  const start = path.dirname(fileURLToPath(import.meta.url))
  let dir = start
  for (let step = 0; step < TREE_ROOT_MAX_ASCENT; step += 1) {
    if (existsSync(path.join(dir, TREE_ROOT_MARKER))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`hook-process: walked up from ${start} without finding an ancestor containing ${TREE_ROOT_MARKER}`)
}

export const TREE_ROOT = findTreeRoot()

const HOOKS_JSON_PATH = path.join(TREE_ROOT, 'hooks', 'hooks.json')

type HooksJsonCommand = { type: string; command: string; timeout: number }
type HooksJsonBinding = { matcher?: string; hooks: HooksJsonCommand[] }
type HooksJson = { hooks: Record<string, HooksJsonBinding[]> }

const readHooksJson = (): HooksJson => {
  const raw = readFileSync(HOOKS_JSON_PATH, 'utf8')
  return JSON.parse(raw) as HooksJson
}

const commandEntryFor = (hookName: HookName): HooksJsonCommand => {
  const eventName = EVENT_NAME_OF[hookName]
  const bindings = readHooksJson().hooks[eventName]
  if (bindings === undefined || bindings.length === 0) {
    throw new Error(`hook-process: ${HOOKS_JSON_PATH} carries no binding for ${eventName}`)
  }
  const entry = bindings[0]?.hooks[0]
  if (entry === undefined) {
    throw new Error(`hook-process: the ${eventName} binding in ${HOOKS_JSON_PATH} declares no command`)
  }
  return entry
}

export const declaredTimeoutMsFor = (hookName: HookName): number => {
  const entry = commandEntryFor(hookName)
  if (typeof entry.timeout !== 'number') {
    throw new Error(`hook-process: the ${EVENT_NAME_OF[hookName]} command in ${HOOKS_JSON_PATH} has no numeric timeout`)
  }
  return entry.timeout * 1000
}

const PLUGIN_ROOT_COMMAND_PATTERN = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)"$/

const relativeEntryPathFrom = (command: string, hookName: HookName): string => {
  const matched = PLUGIN_ROOT_COMMAND_PATTERN.exec(command)
  const relative = matched?.[1]
  if (relative === undefined) {
    throw new Error(`hook-process: the ${EVENT_NAME_OF[hookName]} command in ${HOOKS_JSON_PATH} is ${JSON.stringify(command)}, which does not match the required form node "\${CLAUDE_PLUGIN_ROOT}/<path>"`)
  }
  if (relative.split('/').includes('..')) {
    throw new Error(`hook-process: the ${EVENT_NAME_OF[hookName]} entry path ${relative} escapes the plugin root`)
  }
  if (!relative.endsWith('.ts')) {
    throw new Error(`hook-process: the ${EVENT_NAME_OF[hookName]} entry path ${relative} is not TypeScript source; this plugin ships source and has no build output`)
  }
  if (relative !== `hooks/${hookName}.ts`) {
    throw new Error(`hook-process: the ${EVENT_NAME_OF[hookName]} entry path is ${relative}, but the pinned source module for ${hookName} is hooks/${hookName}.ts`)
  }
  return relative
}

export const entryFor = (hookName: HookName): string => {
  const relative = relativeEntryPathFrom(commandEntryFor(hookName).command, hookName)
  const entry = path.join(TREE_ROOT, ...relative.split('/'))
  if (!existsSync(entry)) {
    throw new Error(`hook-process: ${HOOKS_JSON_PATH} points ${EVENT_NAME_OF[hookName]} at ${entry}, which does not exist`)
  }
  return entry
}

export type HookRunResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export const runHookProcess = (
  hookName: HookName,
  stdin: string,
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): HookRunResult => {
  const entry = entryFor(hookName)
  const result = spawnSync(process.execPath, [entry], {
    input: stdin,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...opts.env
    },
    timeout: opts.timeoutMs,
    killSignal: 'SIGKILL'
  })
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
  }
}

export const runHookProcessWithEvent = (
  hookName: HookName,
  event: unknown,
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): HookRunResult => runHookProcess(hookName, JSON.stringify(event), opts)

const FIXTURES_DIR = path.join(TREE_ROOT, 'test', 'fixtures', 'hook-events')

export type FixtureManifestEntry = {
  file: string
  event: string
  type: string
  field?: string
  value?: string
  status: 'CAPTURED' | 'CONSTRUCTED'
  clientVersion?: string
  capturedFrom?: string
  note?: string
}

export type FixtureManifest = {
  publishedTypesFound: boolean
  typesSource: string
  fixtures: FixtureManifestEntry[]
}

export const readFixtureManifest = (): FixtureManifest => {
  const raw = readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8')
  return JSON.parse(raw) as FixtureManifest
}

export const readFixture = (fileName: string): unknown => {
  const raw = readFileSync(path.join(FIXTURES_DIR, fileName), 'utf8')
  return JSON.parse(raw)
}

export const fixturesForEvent = (eventName: string): FixtureManifestEntry[] =>
  readFixtureManifest().fixtures.filter((entry) => entry.event === eventName)

export const controlledEnv = (overrides: Record<string, string> = {}): Record<string, string> => ({
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  ...overrides
})

export const freshTmpDir = (prefix: string): string => mkdtempSync(path.join(tmpdir(), prefix))
