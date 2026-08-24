import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOOK_NAMES, controlledEnv, runHookProcess } from './hook-process.ts'

const MALFORMED_JSON_STDIN = '{ this is not valid json'

for (const hookName of HOOK_NAMES) {
  test(`hook.${hookName}.crash-is-visible`, () => {
    const result = runHookProcess(hookName, MALFORMED_JSON_STDIN, { env: controlledEnv() })
    assert.notEqual(result.status, 0, `expected ${hookName} to exit non-zero when its handler pipeline throws`)
    assert.equal(result.status, 1, `expected ${hookName} to exit with the code runHook uses for a caught throw`)
    assert.ok(
      result.stderr.length > 0,
      `expected ${hookName} to write a stderr diagnostic when its handler pipeline throws, got empty stderr`
    )
    assert.ok(
      result.stderr.includes(hookName),
      `expected the stderr diagnostic to name "${hookName}" as the crashing hook, got: ${result.stderr}`
    )
    assert.equal(result.stdout, '', `expected ${hookName} to write nothing to stdout on a crash, never a silent success`)
  })
}
