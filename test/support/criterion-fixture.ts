import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { testRuntime } from './runtime.ts'
import { rawGit } from './git-fixture.ts'

export const STUB_TOOL_CTX = {} as unknown as ToolContext

export const withCriterionFixture = async (fn: (rt: Runtime) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-criterion-repo-'))
  const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-criterion-plugin-data-'))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  try {
    rawGit(repo, ['init', '--initial-branch=main'])
    rawGit(repo, ['config', 'user.name', 'Logbook Criterion Fixture'])
    rawGit(repo, ['config', 'user.email', 'criterion@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook criterion fixture repository\n')
    rawGit(repo, ['add', 'README.md'])
    rawGit(repo, ['commit', '-m', 'fixture: initial commit'])
    await fn(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo }))
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginDataHome, { recursive: true, force: true })
  }
}
