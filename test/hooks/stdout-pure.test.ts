import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controlledEnv, readFixture, runHookProcess, type HookName } from './hook-process.ts'

const REPRESENTATIVE_FIXTURE_OF: Readonly<Record<HookName, string>> = {
  'session-start': 'session-start.startup.json',
  'user-prompt-submit': 'user-prompt-submit.json',
  'pre-tool-use': 'pre-tool-use.json',
  'post-tool-use': 'post-tool-use.json',
  'session-end': 'session-end.other.json',
  stop: 'stop.json'
}

const assertStdoutIsPureJsonObject = (stdout: string): void => {
  let firstNonWhitespaceIndex = -1
  for (let i = 0; i < stdout.length; i += 1) {
    if (!/\s/.test(stdout[i] as string)) {
      firstNonWhitespaceIndex = i
      break
    }
  }
  assert.notEqual(firstNonWhitespaceIndex, -1, 'expected stdout to carry at least one non-whitespace character')
  assert.equal(
    stdout[firstNonWhitespaceIndex],
    '{',
    `expected the first non-whitespace character of stdout to be "{", found "${stdout[firstNonWhitespaceIndex]}"`
  )

  let parsed: unknown
  assert.doesNotThrow(() => {
    parsed = JSON.parse(stdout)
  }, 'expected the whole of stdout to parse as JSON')
  assert.equal(typeof parsed, 'object')
  assert.notEqual(parsed, null)
  assert.equal(Array.isArray(parsed), false, 'expected stdout to parse as one JSON object, not an array')
}

for (const [hookName, fixtureFile] of Object.entries(REPRESENTATIVE_FIXTURE_OF) as [HookName, string][]) {
  test(`hook.${hookName}.stdout-pure`, () => {
    const event = readFixture(fixtureFile)
    const result = runHookProcess(hookName, JSON.stringify(event), { env: controlledEnv() })
    assert.equal(result.status, 0, `expected ${hookName} to exit 0 against its representative fixture; stderr: ${result.stderr}`)
    assertStdoutIsPureJsonObject(result.stdout)
  })
}
