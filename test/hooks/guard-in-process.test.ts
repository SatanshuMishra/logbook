import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

type SpawnCounters = {
  totalSpawns: number
  gitSpawns: number
}

const SPAWNING_METHODS = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'exec', 'execSync', 'fork'] as const

const installSpawnCounters = (): { counts: SpawnCounters; restore: () => void } => {
  const require = createRequire(import.meta.url)
  const childProcess = require('node:child_process') as Record<string, (...args: unknown[]) => unknown>
  const originals: Record<string, (...args: unknown[]) => unknown> = {}
  const counts: SpawnCounters = { totalSpawns: 0, gitSpawns: 0 }

  for (const method of SPAWNING_METHODS) {
    originals[method] = childProcess[method] as (...args: unknown[]) => unknown
    childProcess[method] = (...args: unknown[]) => {
      counts.totalSpawns += 1
      if (args[0] === 'git') counts.gitSpawns += 1
      return (originals[method] as (...a: unknown[]) => unknown)(...args)
    }
  }

  return {
    counts,
    restore: () => {
      for (const method of SPAWNING_METHODS) {
        childProcess[method] = originals[method] as (...args: unknown[]) => unknown
      }
    }
  }
}

test('guard.is-in-process', async () => {
  const { counts, restore } = installSpawnCounters()
  try {
    const { guardDecision } = await import('../../src/hooklib/guard.ts')
    const { layoutFor, createStoreDirectories } = await import('../../src/store/layout.ts')
    const { testRuntime } = await import('../support/runtime.ts')

    const projectRoot = mkdtempSync(path.join(tmpdir(), 'logbook-guard-in-process-project-'))
    const pluginDataRoot = mkdtempSync(path.join(tmpdir(), 'logbook-guard-in-process-plugin-data-'))
    const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })

    const layout = layoutFor(rt, projectRoot)
    assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
    if (!layout.ok) throw new Error('unreachable')
    createStoreDirectories(layout.value)

    const events: unknown[] = [
      { tool_name: 'mcp__ledger__open_thread', tool_input: {}, cwd: projectRoot },
      { tool_name: 'mcp__plugin_logbook_ledger__resume_thread', tool_input: {}, cwd: projectRoot },
      { tool_name: 'Write', tool_input: { file_path: path.join(layout.value.root, 'records', 'x.json') }, cwd: projectRoot },
      { tool_name: 'Write', tool_input: { file_path: path.join(projectRoot, 'harmless.txt') }, cwd: projectRoot },
      { tool_name: 'Edit', tool_input: { file_path: path.join(layout.value.state, 'y.json') }, cwd: projectRoot },
      { tool_name: 'Bash', tool_input: { command: `rm -rf ${layout.value.root}` }, cwd: projectRoot },
      { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: projectRoot },
      { tool_name: 'Read', tool_input: { file_path: path.join(projectRoot, 'harmless.txt') }, cwd: projectRoot },
      { tool_name: 'NotACallWeGuard', tool_input: {}, cwd: projectRoot }
    ]

    for (const event of events) {
      guardDecision(rt, event)
    }

    assert.equal(counts.gitSpawns, 0, 'expected guardDecision to spawn a "git" subprocess zero times')
    assert.equal(counts.totalSpawns, 0, 'expected guardDecision to spawn any subprocess zero times')
  } finally {
    restore()
  }
})

test('guard.is-in-process.control.the-counter-detects-a-real-spawn', () => {
  const { counts, restore } = installSpawnCounters()
  try {
    const require = createRequire(import.meta.url)
    const childProcess = require('node:child_process') as { spawnSync: (...args: unknown[]) => unknown }
    childProcess.spawnSync(process.execPath, ['--version'])
    assert.equal(counts.totalSpawns, 1, 'expected the installed counter to observe the real spawnSync call it wraps')
  } finally {
    restore()
  }
})
