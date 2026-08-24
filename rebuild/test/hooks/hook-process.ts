import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REBUILD_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HOOKS_JSON_PATH = path.join(REBUILD_ROOT, 'hooks', 'hooks.json')
const DIST_HOOKS_DIR = path.join(REBUILD_ROOT, 'dist', 'hooks')

export type HookName = 'session-start' | 'user-prompt-submit' | 'pre-tool-use' | 'post-tool-use' | 'session-end' | 'stop'

const EVENT_NAME_OF: Readonly<Record<HookName, string>> = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  'session-end': 'SessionEnd',
  stop: 'Stop'
}

export const HOOK_NAMES: readonly HookName[] = [
  'session-start',
  'user-prompt-submit',
  'pre-tool-use',
  'post-tool-use',
  'session-end',
  'stop'
]

type HooksJsonEntry = { hooks: { command: string; timeout: number }[] }
type HooksJson = { hooks: Record<string, HooksJsonEntry[]> }

const readHooksJson = (): HooksJson => {
  const raw = readFileSync(HOOKS_JSON_PATH, 'utf8')
  return JSON.parse(raw) as HooksJson
}

export const declaredTimeoutMsFor = (hookName: HookName): number => {
  const parsed = readHooksJson()
  const eventName = EVENT_NAME_OF[hookName]
  const bindings = parsed.hooks[eventName]
  if (bindings === undefined || bindings.length === 0) {
    throw new Error(`declaredTimeoutMsFor: hooks.json carries no binding for ${eventName}`)
  }
  const timeoutSeconds = bindings[0]?.hooks[0]?.timeout
  if (typeof timeoutSeconds !== 'number') {
    throw new Error(`declaredTimeoutMsFor: hooks.json binding for ${eventName} has no numeric timeout`)
  }
  return timeoutSeconds * 1000
}

const distEntryFor = (hookName: HookName): string => {
  const entry = path.join(DIST_HOOKS_DIR, `${hookName}.js`)
  if (!existsSync(entry)) {
    throw new Error(`distEntryFor: built hook not found at ${entry}. Run \`npm run rebuild:build\` first.`)
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
  const entry = distEntryFor(hookName)
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

const FIXTURES_DIR = path.join(REBUILD_ROOT, 'test', 'fixtures', 'hook-events')

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
