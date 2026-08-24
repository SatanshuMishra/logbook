import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HOOK_NAMES,
  controlledEnv,
  declaredTimeoutMsFor,
  fixturesForEvent,
  readFixture,
  runHookProcess,
  type HookName
} from './hook-process.ts'

const EVENT_NAME_OF: Readonly<Record<HookName, string>> = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  'session-end': 'SessionEnd',
  stop: 'Stop'
}

for (const hookName of HOOK_NAMES) {
  test(`hook.${hookName}.no-hang`, () => {
    const declaredTimeoutMs = declaredTimeoutMsFor(hookName)
    const halfBudgetMs = Math.floor(declaredTimeoutMs / 2)
    const fixtures = fixturesForEvent(EVENT_NAME_OF[hookName])
    assert.ok(fixtures.length > 0, `expected at least one fixture for ${EVENT_NAME_OF[hookName]}`)

    for (const fixture of fixtures) {
      const event = readFixture(fixture.file)
      const result = runHookProcess(hookName, JSON.stringify(event), {
        env: controlledEnv(),
        timeoutMs: halfBudgetMs
      })
      assert.equal(
        result.timedOut,
        false,
        `expected ${hookName} to exit within half its declared budget (${halfBudgetMs}ms) against ${fixture.file}, but it was killed for exceeding the deadline`
      )
      assert.notEqual(
        result.signal,
        'SIGKILL',
        `expected ${hookName} not to be killed by the wall-clock guard against ${fixture.file}`
      )
    }
  })
}
