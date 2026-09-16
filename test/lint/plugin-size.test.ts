import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS_DIR = fileURLToPath(new URL('../../hooks', import.meta.url))
const PLUGIN_LINE_BUDGET = 400

const walkFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkFiles(full)
    return entry.isFile() ? [full] : []
  })

const nonBlankLineCount = (contents: string): number => contents.split('\n').filter((line) => line.trim().length > 0).length

test('contract.plugin-half-under-400', () => {
  const files = walkFiles(HOOKS_DIR)
  assert.ok(files.length > 0, `expected to find files under ${HOOKS_DIR}`)

  const total = files.reduce((sum, file) => sum + nonBlankLineCount(readFileSync(file, 'utf8')), 0)

  assert.ok(
    total < PLUGIN_LINE_BUDGET,
    `expected the plugin half (${HOOKS_DIR}) to total under ${PLUGIN_LINE_BUDGET} non-blank lines, got ${total} across ${files.length} files`
  )
})
