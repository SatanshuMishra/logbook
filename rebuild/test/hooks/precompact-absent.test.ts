import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { REBUILD_ROOT } from './hook-process.ts'

test('hook.precompact-absent', () => {
  const hooksJsonPath = path.join(REBUILD_ROOT, 'hooks', 'hooks.json')
  const parsed = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as { hooks: Record<string, unknown> }
  assert.deepEqual(
    Object.keys(parsed.hooks).filter((key) => key === 'PreCompact'),
    [],
    'expected no PreCompact key in hooks.json'
  )

  const preCompactFile = path.join(REBUILD_ROOT, 'hooks', 'pre-compact.ts')
  assert.equal(existsSync(preCompactFile), false, `expected no file at ${preCompactFile}`)
})
