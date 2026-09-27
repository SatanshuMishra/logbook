import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { TREE_ROOT } from '../hooks/hook-process.ts'

test('hooks.no-subagent-stop-binding-so-helpers-are-never-blocked', () => {
  const hooksJsonPath = path.join(TREE_ROOT, 'hooks', 'hooks.json')
  const parsed = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as { hooks: Record<string, unknown> }
  assert.deepEqual(
    Object.keys(parsed.hooks).filter((key) => key === 'SubagentStop'),
    [],
    `expected no SubagentStop key in ${hooksJsonPath}, because a helper blocked at stop answers the block instead of repeating its report`
  )

  const hookScript = path.join(TREE_ROOT, 'hooks', 'subagent-stop.ts')
  assert.equal(existsSync(hookScript), false, `expected no file at ${hookScript}`)

  const gateModule = path.join(TREE_ROOT, 'src', 'hooklib', 'subagent-stop-gate.ts')
  assert.equal(existsSync(gateModule), false, `expected no file at ${gateModule}`)
})
