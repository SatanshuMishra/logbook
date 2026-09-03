import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  EVENT_NAME_OF,
  HOOK_NAMES,
  controlledEnv,
  entryFor,
  fixturesForEvent,
  freshPluginDataDir,
  freshTmpDir,
  readFixture,
  type FixtureManifestEntry,
  type HookName
} from './hook-process.ts'
import { guardDecision } from '../../src/hooklib/guard.ts'
import { layoutFor } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'

type BrokenCwdRun = { status: number | null; stdout: string; stderr: string }

const RMDIR_FAILED_EXIT = 90
const PWD_STILL_WORKS_EXIT = 91

const BREAK_CWD_SCRIPT = [
  `rmdir "$1" || { echo REPRO_SETUP_FAILED_RMDIR >&2; exit ${RMDIR_FAILED_EXIT}; }`,
  `if /bin/pwd >/dev/null 2>&1; then echo REPRO_SETUP_FAILED_PWD_STILL_WORKS >&2; exit ${PWD_STILL_WORKS_EXIT}; fi`,
  'exec "$2" "$3"'
].join('\n')

const runEntryWithUnreadableCwd = (
  entry: string,
  stdin: string,
  env: Record<string, string>
): BrokenCwdRun => {
  const victim = mkdtempSync(path.join(tmpdir(), 'logbook-unreadable-cwd-'))
  const result = spawnSync('/bin/sh', ['-c', BREAK_CWD_SCRIPT, 'sh', victim, process.execPath, entry], {
    cwd: victim,
    input: stdin,
    encoding: 'utf8',
    env
  })
  assert.notEqual(
    result.status,
    RMDIR_FAILED_EXIT,
    `the fixture setup could not remove its own working directory ${victim}: ${result.stderr}`
  )
  assert.notEqual(
    result.status,
    PWD_STILL_WORKS_EXIT,
    `the fixture setup removed ${victim} but the child process could still resolve its working directory, so the unreadable-cwd condition was never established: ${result.stderr}`
  )
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const envFor = (pluginDataRoot: string, sessionId: string): Record<string, string> =>
  controlledEnv({ CLAUDE_PLUGIN_DATA: pluginDataRoot, CLAUDE_CODE_SESSION_ID: sessionId })

const GIT_INIT_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const gitInitedProjectDir = (prefix: string): string => {
  const dir = freshTmpDir(prefix)
  const result = spawnSync('git', ['-C', dir, 'init', '-q'], { env: GIT_INIT_ENV, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`unreadable-cwd: git init failed for the fixture project directory ${dir}: ${result.stderr}`)
  }
  return dir
}

const eventWithRelocatedCwd = (
  fixtureFile: string,
  projectDir: string
): { event: Record<string, unknown>; sessionId: string } => {
  const raw = readFixture(fixtureFile)
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${fixtureFile}: fixture did not parse to an object`)
  }
  const record = raw as Record<string, unknown>
  const sessionId = record.session_id
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error(`${fixtureFile}: fixture carries no non-empty string session_id`)
  }
  const event = {
    ...record,
    cwd: projectDir,
    transcript_path: path.join(projectDir, 'transcript.jsonl')
  }
  return { event, sessionId }
}

const primaryFixtureFor = (hookName: HookName): FixtureManifestEntry => {
  const fixtures = fixturesForEvent(EVENT_NAME_OF[hookName])
  const captured = fixtures.find((fixture) => fixture.status === 'CAPTURED')
  if (captured === undefined) {
    throw new Error(
      `unreadable-cwd: no CAPTURED fixture exists for ${EVENT_NAME_OF[hookName]}; the unreadable-cwd census cannot proceed without a real captured payload for every hook`
    )
  }
  return captured
}

const RUNTIME_CWD_UNREADABLE_EVENT = 'runtime.cwd-unreadable'

const assertOnlyCwdUnreadableDiagnostics = (hookName: HookName, stderr: string): void => {
  const lines = stderr.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    assert.ok(
      !line.includes('crashed:'),
      `expected ${hookName} stderr to carry no "crashed:" diagnostic, got: ${line}`
    )
    const parsed = JSON.parse(line) as Record<string, unknown>
    assert.equal(
      parsed.event,
      RUNTIME_CWD_UNREADABLE_EVENT,
      `expected every ${hookName} stderr diagnostic under an unreadable cwd to be a ${RUNTIME_CWD_UNREADABLE_EVENT} warning, got: ${line}`
    )
  }
}

for (const hookName of HOOK_NAMES) {
  const fixture = primaryFixtureFor(hookName)

  test(`hook.${hookName}.unreadable-cwd`, () => {
    const projectDir = gitInitedProjectDir(`logbook-unreadable-cwd-${hookName}-project-`)
    const pluginData = freshPluginDataDir(`logbook-unreadable-cwd-${hookName}-data-`)
    try {
      const { event, sessionId } = eventWithRelocatedCwd(fixture.file, projectDir)

      const run = runEntryWithUnreadableCwd(
        entryFor(hookName),
        JSON.stringify(event),
        envFor(pluginData.root, sessionId)
      )

      assert.equal(run.status, 0, `the ${hookName} hook exited ${String(run.status)}: ${run.stderr}`)
      assert.doesNotThrow(
        () => JSON.parse(run.stdout),
        `expected ${hookName} stdout to be valid JSON, got: ${JSON.stringify(run.stdout)}`
      )
      assertOnlyCwdUnreadableDiagnostics(hookName, run.stderr)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
      rmSync(pluginData.home, { recursive: true, force: true })
    }
  })
}

test('hook.guard.unreadable-cwd.denies-write-and-asks-bash', () => {
  const rt = testRuntime({ cwd: null })

  const writeVerdict = guardDecision(rt, { tool_name: 'Write', tool_input: { file_path: '/whatever.json' } })
  assert.equal(
    writeVerdict.kind,
    'deny',
    `expected a Write with no readable cwd to be denied, got ${JSON.stringify(writeVerdict)}`
  )

  const bashVerdict = guardDecision(rt, { tool_name: 'Bash', tool_input: { command: 'echo hi' } })
  assert.equal(
    bashVerdict.kind,
    'ask',
    `expected a Bash command with no readable cwd to ask rather than silently allow, got ${JSON.stringify(bashVerdict)}`
  )
})

test('hook.guard.unreadable-cwd.layoutFor-refuses-on-projectRoot', () => {
  const rt = testRuntime({ cwd: null })

  const layout = layoutFor(rt, null)
  assert.equal(layout.ok, false, 'expected layoutFor to refuse when projectRoot is null')
  if (layout.ok) throw new Error('unreachable')
  assert.equal(
    layout.field,
    'projectRoot',
    `expected the refusal to name projectRoot as the failing field, got ${JSON.stringify(layout.field)}`
  )
})
